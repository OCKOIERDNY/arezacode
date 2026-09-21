import assert from "node:assert/strict"
import { once } from "node:events"
import { writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { join } from "node:path"
import { app, BrowserWindow, WebContentsView } from "electron"
import { registerBrowserHandlers } from "../src/main/browser-view"

app.setPath("userData", process.env.BROWSER_TEST_DIR!)
app.on("window-all-closed", () => {})
async function run() {
  await app.whenReady()
  registerBrowserHandlers()
  const server = createServer((request, response) => {
    response.setHeader("X-Frame-Options", "DENY")
    response.setHeader("Content-Type", "text/html")
    if (request.url === "/default-background") {
      response.end("<html><title>Light preview</title><body><h1>Light page</h1><p>Default browser background</p></body></html>")
      return
    }
    response.end(
      `<html><title>${request.url}</title><body style="background:#202020;color:white;font:20px system-ui;padding:32px"><h1>Embedded browser</h1><p>${request.url}</p><a href="/two">Next page</a></body></html>`,
    )
  }).listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  assert(address && typeof address !== "string")
  const url = `http://127.0.0.1:${address.port}`
  const preload = join(process.env.BROWSER_TEST_DIR!, "preload.cjs")
  await writeFile(
    preload,
    `const {contextBridge,ipcRenderer}=require("electron");contextBridge.exposeInMainWorld("browser",{update:input=>ipcRenderer.invoke("browser-update",input),close:id=>ipcRenderer.invoke("browser-close",id)})`,
  )
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    show: true,
    webPreferences: { preload, sandbox: true, contextIsolation: true },
  })
  await win.loadURL(`${url}/host`)
  const update = (input: object) =>
    win.webContents.executeJavaScript(`window.browser.update(${JSON.stringify({ id: "test", ...input })})`)
  try {
    await assert.rejects(update({ url: "file:///etc/passwd" }), /Invalid browser URL/)
    await assert.rejects(update({ url: "https://user:password@example.com" }), /Invalid browser URL/)
    await assert.rejects(update({ bounds: { x: "wrong", y: 0, width: 100, height: 100 } }), /Invalid browser bounds/)
    await update({ bounds: { x: 380, y: 80, width: 580, height: 550 }, visible: false })
    const view = win.contentView.children.find(
      (child) => child instanceof WebContentsView && child.webContents !== win.webContents,
    ) as WebContentsView
    assert(view)
    const contents = view.webContents
    const navigated = (target: string) =>
      new Promise<void>((resolve) => {
        const ready = () => {
          if (view.webContents.getURL() !== target || view.webContents.isLoading()) return
          view.webContents.removeListener("did-stop-loading", ready)
          resolve()
        }
        view.webContents.on("did-stop-loading", ready)
        ready()
      })
    assert.equal(view.getVisible(), false)
    const loaded = navigated(`${url}/one`)
    await update({ url: `${url}/one`, visible: true })
    await loaded
    assert.equal(await view.webContents.executeJavaScript("document.title"), "/one")
    assert.equal(
      await view.webContents.executeJavaScript("typeof require + ':' + typeof window.browser"),
      "undefined:undefined",
    )
    await view.webContents.session.cookies.set({ url, name: "isolated", value: "test" })
    assert.equal((await win.webContents.session.cookies.get({ name: "isolated" })).length, 0)
    const next = navigated(`${url}/two`)
    void view.webContents.executeJavaScript("document.querySelector('a').click()", true)
    await next
    assert.equal(view.webContents.getTitle(), "/two")
    assert.equal(view.webContents.navigationHistory.canGoBack(), true)
    const back = navigated(`${url}/one`)
    await update({ action: "back" })
    await back
    assert.equal(view.webContents.getURL(), `${url}/one`)
    await update({ visible: false })
    assert.equal(view.getVisible(), false)
    await update({ visible: true })
    assert.equal(view.getVisible(), true)
    assert.deepEqual(view.getBounds(), { x: 380, y: 80, width: 580, height: 550 })
    await writeFile("/tmp/areza-panels-native-browser.png", (await win.capturePage()).toPNG())
    await win.webContents.executeJavaScript("history.pushState({}, '', '/host#same-document')")
    assert.equal(view.webContents.isDestroyed(), false)
    const light = navigated(`${url}/default-background`)
    await update({ url: `${url}/default-background` })
    await light
    assert.equal(await contents.executeJavaScript("getComputedStyle(document.body).backgroundColor"), "rgba(0, 0, 0, 0)")
    const screenshot = await contents.capturePage()
    assert.deepEqual([...screenshot.getBitmap().subarray(0, 4)], [255, 255, 255, 255])
    await writeFile("/tmp/areza-preview-light-background.png", screenshot.toPNG())
    await win.webContents.executeJavaScript("window.browser.close('test')")
    assert.equal(contents.isDestroyed(), true)
    assert.equal(win.contentView.children.includes(view), false)
    await update({ url: `${url}/one`, visible: true })
    const remaining = (win.contentView.children[0] as WebContentsView).webContents
    const teardown = new Promise<void>((resolve, reject) => {
      process.once("uncaughtException", reject)
      win.once("closed", () => setTimeout(() => {
        process.removeListener("uncaughtException", reject)
        resolve()
      }, 20))
    })
    win.destroy()
    await teardown
    assert.equal(remaining.isDestroyed(), true)
    process.stdout.write("Browser isolation, navigation, visibility and cleanup passed\n")
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.stack : String(error)) + "\n")
    process.exitCode = 1
  } finally {
    if (!win.isDestroyed()) win.destroy()
    server.close()
    app.exit(process.exitCode || 0)
  }
}
void run()
