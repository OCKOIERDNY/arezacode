import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page, type WebSocketRoute } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/TerminalTabSwitch"
const projectID = "proj_terminal_tab_switch"
const sessionA = "ses_terminal_tab_a"
const sessionB = "ses_terminal_tab_b"
const titleA = "Alpha session"
const titleB = "Beta session"
const ptyID = "pty_tab_switch"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
// Marks the terminal DOM node so a remount (fresh node) is detectable.
const PROBE = "original"

test.use({ viewport: { width: 1440, height: 900 } })

test("replays the shell at its original width and hides the browser caret", async ({ page }) => {
  const sizes: unknown[] = []
  let socket: WebSocketRoute | undefined
  await setup(page, (ws) => {
    socket = ws
    ws.send(`\x1b[7m%\x1b[27m${" ".repeat(79)}\r \r\x1b[Kproject % `)
  })
  await page.route(`**/api/pty/${ptyID}?*`, async (route) => {
    if (route.request().method() === "PUT") sizes.push(route.request().postDataJSON())
    await route.fulfill({ json: { location: ptyLocation(), data: ptyInfo() } })
  })
  await page.addInitScript(() =>
    localStorage.setItem("opencode.global.dat:layout", JSON.stringify({ review: { panelOpened: true } })),
  )
  await page.goto(sessionHref(sessionA))
  const panel = page.locator("#review-panel")
  await panel.getByRole("button", { name: "New tab", exact: true }).click()
  await panel.getByRole("button", { name: "Terminal", exact: true }).click()
  const terminal = panel.locator('[data-component="terminal"]')
  await expect.poll(() => !!socket).toBe(true)
  await expect(terminal.locator("canvas")).toHaveCSS("visibility", "hidden")
  await terminal.click({ position: { x: 4, y: 4 } })
  await expect(terminal).toHaveCSS("caret-color", "rgba(0, 0, 0, 0)")
  expect(sizes).toEqual([])
  socket!.send(Buffer.from(`\0${JSON.stringify({ cursor: 120 })}`))
  await expect.poll(() => sizes.length).toBeGreaterThan(0)
  await expect(terminal.locator("canvas")).toBeVisible()
  await page.screenshot({ path: "/tmp/areza-terminal-fixed.png" })
  expect(await terminal.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d")!
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const background = Array.from(data.slice(data.length - 4, data.length - 1))
    const bottom = Math.ceil(30 * devicePixelRatio)
    for (let y = bottom; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width - 20; x++) {
        const offset = (y * canvas.width + x) * 4
        if (background.some((color, i) => Math.abs(data[offset + i]! - color) > 20)) return false
      }
    }
    return true
  })).toBe(true)
})

test("opens an embedded terminal from the panel picker and preserves it across panel tabs", async ({ page }) => {
  const connections = await setup(page)
  await page.addInitScript(() =>
    localStorage.setItem("opencode.global.dat:layout", JSON.stringify({ review: { panelOpened: true } })),
  )
  await page.goto(sessionHref(sessionA))
  await expectSessionTitle(page, titleA)
  const panel = page.locator("#review-panel")
  await panel.getByRole("button", { name: "New tab", exact: true }).click()
  await panel.getByRole("button", { name: "Terminal", exact: true }).click()
  const terminal = panel.locator('[data-component="terminal"]')
  await expect(terminal).toBeVisible()
  await expect.poll(() => connections.length).toBe(1)
  await writeProbe(page)
  await page.screenshot({ path: "/tmp/areza-panels-terminal.png" })
  await panel.getByRole("button", { name: "New tab", exact: true }).click()
  await expect(terminal).toBeHidden()
  await panel.getByRole("tab", { name: "Terminal", exact: true }).click()
  await expect(terminal).toBeVisible()
  expect(await readProbe(page)).toBe(PROBE)
  expect(connections.length).toBe(1)
})

// Terminals are workspace-scoped: switching between session tabs in the same
// workspace must keep the terminal mounted and its PTY connection open instead
// of tearing it down and reconnecting.
test("keeps the terminal session alive when switching session tabs in a workspace", async ({ page }) => {
  const connections = await setup(page)

  await page.goto(sessionHref(sessionA))
  await expectSessionTitle(page, titleA)

  await page.keyboard.press("Control+Backquote")
  const terminal = page.locator('[data-component="terminal"]')
  await expect(terminal).toBeVisible()
  await expect.poll(() => connections.length).toBe(1)
  const connection = new URL(connections[0]!)
  expect(connection.pathname).toBe(`/api/pty/${ptyID}/connect`)
  expect(connection.searchParams.get("location[directory]")).toBe(directory)
  expect(connection.searchParams.get("ticket")).toBeNull()
  await writeProbe(page)

  await switchTab(page, titleB)
  await expectSessionTitle(page, titleB)
  await expect(terminal).toBeVisible()
  expect(await readProbe(page)).toBe(PROBE)
  expect(connections.length).toBe(1)

  await switchTab(page, titleA)
  await expectSessionTitle(page, titleA)
  await expect(terminal).toBeVisible()
  expect(await readProbe(page)).toBe(PROBE)
  expect(connections.length).toBe(1)
})

type Probed = HTMLElement & { __e2eProbe?: string }

async function switchTab(page: Page, title: string) {
  await page.locator("[data-titlebar-tab-slot]", { hasText: title }).click()
}

async function writeProbe(page: Page) {
  await page.locator('[data-component="terminal"]').evaluate((el, probe) => {
    ;(el as Probed).__e2eProbe = probe
  }, PROBE)
}

async function readProbe(page: Page) {
  return page.locator('[data-component="terminal"]').evaluate((el) => (el as Probed).__e2eProbe)
}

async function setup(page: Page, connected?: (socket: WebSocketRoute) => void) {
  await mockOpenCodeServer(page, {
    protocol: "v2",
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "terminal-tab-switch",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: { test: { id: "test", name: "Test", limit: { context: 200_000 } } },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "test" },
    },
    sessions: [session(sessionA, titleA, 1700000000000), session(sessionB, titleB, 1700000001000)],
    pageMessages: () => ({ items: [] }),
  })
  await page.route("**/api/pty*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ location: ptyLocation(), data: ptyInfo() }),
    }),
  )
  await page.route(`**/api/pty/${ptyID}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ location: ptyLocation(), data: ptyInfo() }),
    }),
  )
  await page.route(`**/api/pty/${ptyID}/connect-token*`, (route) => {
    expect(route.request().headers()["x-opencode-ticket"]).toBe("1")
    const url = new URL(route.request().url())
    expect(url.searchParams.get("location[directory]")).toBe(directory)
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ location: ptyLocation(), data: { ticket: "e2e-ticket", expires_in: 60 } }),
    })
  })
  const connections: string[] = []
  await page.routeWebSocket(new RegExp(`/api/pty/${ptyID}/connect`), (ws) => {
    connections.push(ws.url())
    if (connected) connected(ws)
    else ws.send(Buffer.from('\0{"cursor":0}'))
  })

  await page.addInitScript(
    ({ directory, server, sessions }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify(sessions.map((sessionId: string) => ({ type: "session", server, sessionId }))),
      )
    },
    { directory, server, sessions: [sessionA, sessionB] },
  )
  return connections
}

function session(id: string, title: string, created: number) {
  return {
    id,
    slug: id,
    projectID,
    directory,
    title,
    version: "dev",
    time: { created, updated: created },
  }
}

function sessionHref(sessionID: string) {
  return `/server/${base64Encode(server)}/session/${sessionID}`
}

function ptyLocation() {
  return { directory, project: { id: projectID, directory } }
}

function ptyInfo() {
  return { id: ptyID, title: "Terminal 1", command: "cmd.exe", args: [], cwd: directory, status: "running", pid: 1 }
}
