import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFile, stat, writeFile } from "node:fs/promises"
import { app, BaseWindow, BrowserWindow, webContents } from "electron"
import { Schema } from "effect"
import { Browser } from "@opencode-ai/core/browser"
import { registerBrowserHandlers } from "./browser-view"

app.setPath("userData", process.env.AREZACODE_BROWSER_TEST_DATA!)
void app
  .whenReady()
  .then(run)
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })

async function run() {
  const schema = Schema.toJsonSchemaDocument(Browser.Input).schema
  assert.equal(schema.type, "object")
  assert.equal(schema.anyOf, undefined)
  for (const input of [{ action: "open" }, { action: "click" }, { action: "fill", ref: 1 }, { action: "press" }]) {
    assert.throws(() => Schema.decodeUnknownSync(Browser.Input)(input))
  }
  const server = createServer((_request, response) =>
    response.end(
      "<!doctype html><html><head><title>Browser tool verification</title><style>body{font:24px system-ui;background:#fff;color:#222;padding:40px}input,button{font:inherit;margin:12px;padding:8px}</style></head><body><h1>Browser tool verification</h1><form onsubmit=\"event.preventDefault();document.querySelector('output').textContent='Saved '+document.querySelector('input').value\"><label>Your name<input></label><button>Save</button></form><output aria-live=\"polite\">Ready</output></body></html>",
    ),
  )
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert(address && typeof address !== "string")
  const url = `http://127.0.0.1:${address.port}`
  const sessionID = "ses_browser_control_integration"
  const directory = process.cwd()
  await registerBrowserHandlers()
  assert.equal(Browser.available(), true)
  assert.equal((await stat(Browser.connectionFile)).mode & 0o777, 0o600)
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 650,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  })
  await win.loadURL("data:text/html,<title>Browser control test harness</title>")
  win.show()
  win.focus()
  const ipc = (channel: string, value: unknown) =>
    win.webContents.executeJavaScript(
      `require('electron').ipcRenderer.invoke(${JSON.stringify(channel)}, ${JSON.stringify(value)})`,
    )
  await ipc("browser-bind", { sessionID, directory })
  const run = (input: Browser.Input) => Browser.execute({ sessionID, directory, input })
  try {
    const connection = JSON.parse(await readFile(Browser.connectionFile, "utf8")) as { port: number; token: string }
    const endpoint = `http://127.0.0.1:${connection.port}/browser`
    assert.equal((await fetch(endpoint, { method: "POST", body: "{}" })).status, 403)
    assert.equal(
      (
        await fetch(endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${connection.token}`, origin: url },
          body: "{}",
        })
      ).status,
      403,
    )
    await assert.rejects(
      Browser.execute({ sessionID, directory: directory + "/other", input: { action: "open", url } }),
      /Open this task/,
    )
    await assert.rejects(run({ action: "open", url: "file:///etc/passwd" }), /HTTP/)
    await assert.rejects(run({ action: "open", url: "http://user:password@localhost/" }), /credentials/)
    const initial = await run({ action: "open", url })
    assert.equal(initial.title, "Browser tool verification")
    const field = Number(initial.text.match(/\[ref=(\d+)\] textbox "Your name"/)?.[1])
    const button = Number(initial.text.match(/\[ref=(\d+)\] button "Save"/)?.[1])
    assert(field && button, initial.text)
    await ipc("browser-update", {
      id: `agent_${sessionID}`,
      bounds: { x: 900, y: 0, width: 0, height: 600 },
      visible: false,
    })
    win.hide()
    const hidden = await run({ action: "screenshot" })
    assert(hidden.image, "Hidden browser must return a screenshot")
    assert.equal(win.isVisible(), false, "Capture must not foreground the app")
    assert.equal(BaseWindow.getAllWindows().length, 1, "Capture host must be disposed")
    await writeFile("/tmp/areza-browser-hidden.png", Buffer.from(hidden.image, "base64"))
    win.show()
    assert((await run({ action: "screenshot" })).image, "Collapsed browser must return a screenshot")
    await ipc("browser-update", {
      id: `agent_${sessionID}`,
      bounds: { x: 0, y: 0, width: 900, height: 600 },
      visible: true,
    })
    await run({ action: "fill", ref: field, text: "Ada" })
    await run({ action: "click", ref: button })
    assert.match((await run({ action: "snapshot" })).text, /Saved Ada/)
    await run({ action: "fill", ref: field, text: "Lin" })
    await run({ action: "press", key: "Enter" })
    assert.match((await run({ action: "snapshot" })).text, /Saved Lin/)
    const preview = await ipc("browser-update", { id: `agent_${sessionID}`, action: "capture" })
    assert.match(preview.preview, /^data:image\/png;base64,/)
    assert.equal(preview.url, url + "/")
    await ipc("browser-update", { id: `agent_${sessionID}`, visible: false })
    await ipc("browser-update", { id: `agent_${sessionID}`, visible: true })
    assert.match((await run({ action: "snapshot" })).text, /Saved Lin/)
    const screenshot = await run({ action: "screenshot" })
    assert(screenshot.image)
    const png = Buffer.from(screenshot.image, "base64")
    assert.equal(png.subarray(1, 4).toString(), "PNG")
    await writeFile("/tmp/areza-browser-control.png", png)
    const target = webContents.getAllWebContents().find((contents) => contents.getURL() === url + "/")!
    await target.debugger.sendCommand("Debugger.enable")
    await target.debugger.sendCommand("Debugger.pause")
    await assert.rejects(
      Browser.execute({ sessionID, directory, input: { action: "click", ref: button } }, AbortSignal.timeout(200)),
      /timeout/,
    )
    const recovered = await Browser.execute(
      { sessionID, directory, input: { action: "snapshot" } },
      AbortSignal.timeout(2000),
    )
    assert.match(recovered.text, /Saved Lin/, "A timed-out action must release the queue without resetting the page")
    await run({ action: "open", url: url + "/next" })
    await assert.rejects(run({ action: "click", ref: button }), /stale/)
    await ipc("browser-close", `agent_${sessionID}`)
    await assert.rejects(run({ action: "snapshot" }), /Open a URL/)
    console.log(
      "Browser control: open, snapshot, click, fill, keyboard, screenshot, stale refs and access isolation passed",
    )
  } finally {
    server.close()
    win.destroy()
    app.quit()
  }
}
