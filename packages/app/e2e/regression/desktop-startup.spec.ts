import { existsSync } from "node:fs"
import { test, expect } from "@playwright/test"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

const renderer = new URL("../../../desktop/out/renderer/", import.meta.url).pathname

test("desktop restores layout and manages project servers and previews", async ({ page }) => {
  test.skip(!existsSync(`${renderer}index.html`), "Build the desktop renderer first")
  const layout = Promise.withResolvers<void>()
  let requested = false
  await page.exposeFunction("readStartupLayout", async () => {
    requested = true
    await layout.promise
    return JSON.stringify({ review: { panelOpened: true, diffStyle: "split" } })
  })
  await mockOpenCodeServer(page, { sessions: fixture.sessions, provider: fixture.provider, directory: fixture.directory, project: fixture.project, pageMessages })
  await page.route("**/*", (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().isNavigationRequest() || path.startsWith("/assets/") || /^\/(?:areza-flower\.svg|oc-theme-preload\.js|favicon.*)$/.test(path)) {
      return route.fulfill({ path: `${renderer}${route.request().isNavigationRequest() ? "index.html" : path.slice(1)}` })
    }
    return route.fallback()
  })
  const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4446"}`
  await page.addInitScript(({ sessionID, server }) => {
    localStorage.setItem("opencode.desktop.window.startup-test.last-active-url", `/server/c2lkZWNhcg/session/${sessionID}`)
    localStorage.setItem("opencode-color-scheme", "dark")
    const store = new Map<string, string>()
    let services = [
      { id: "process:123", kind: "process", name: "vite", pid: 123, ports: [5173], urls: ["http://localhost:5173/"] },
      { id: "container:postgres", kind: "container", name: "project-postgres", ports: [5435], urls: [] },
    ]
    const browser = { id: "", url: "", title: "", loading: false, back: false, forward: false }
    const browsers = new Map<string, typeof browser>()
    const api: Record<string, unknown> = {
      projectServices: {
        list: async () => ({ services, processes: "available", docker: "available" }),
        stop: async (_directory: string, id: string) => { services = services.filter((service) => service.id !== id) },
      },
      browser: {
        bind: async (scope: unknown) => { Reflect.set(window, "browserScope", scope) },
        onOpen: (callback: (sessionID: string) => void) => { Reflect.set(window, "openAgentBrowser", callback); return () => {} },
        update: async (input: { id: string; url?: string; visible?: boolean; action?: string }) => {
          if (input.visible !== undefined) Reflect.set(window, "browserVisible", input.visible)
          const state = browsers.get(input.id) ?? { ...browser, id: input.id }
          browsers.set(input.id, state)
          Object.assign(state, input.url ? { url: input.url } : {})
          if (input.action === "capture") return {
            ...state,
            preview: "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="white"/><text x="48" y="90" font-family="sans-serif" font-size="32">Local preview: current page</text></svg>'),
          }
          return state
        },
        subscribe: () => () => {},
        close: async () => {},
      },
      updater: { subscribe: () => () => {} },
      wslServers: { subscribe: () => () => {}, getState: async () => ({ distros: [] }) },
      getWindowID: async () => "startup-test",
      awaitInitialization: async () => ({ url: server }),
      getDefaultServerUrl: async () => "sidecar",
      consumeInitialDeepLinks: async () => [],
      isOldLayoutEligible: async () => false,
      isFirstLaunchOnboardingPending: async () => false,
      storeGet: async (name: string, key: string) => {
        if (key === "layout") return Reflect.get(window, "readStartupLayout")()
        if (key === "settings.v3") return JSON.stringify({ general: { newLayoutDesigns: true, showStatus: true } })
        return store.get(`${name}:${key}`) ?? null
      },
      storeSet: async (name: string, key: string, value: string) => { store.set(`${name}:${key}`, value) },
      storeKeys: async () => [],
      storeLength: async () => 0,
    }
    Object.assign(window, { api: new Proxy(api, { get: (target, key) => target[String(key)] ?? (String(key).startsWith("on") ? () => () => {} : async () => null) }) })
  }, { sessionID: fixture.sourceID, server })
  try {
    await page.goto("/")
    await expect.poll(() => requested).toBe(true)
    await expect(page.getByRole("heading", { name: fixture.expected.sourceTitle })).toBeAttached()
    await expect(page.locator('[data-message-id]').first()).toBeAttached()
    await expect(page.locator('#startup-splash')).toBeVisible()
    await page.screenshot({ path: "/tmp/areza-desktop-restoring-layout.png" })
    layout.resolve()
    await expect(page.locator('#startup-splash')).toBeHidden()
    await expect(page.locator('[data-component="session-right-panel"]')).toHaveAttribute("data-opened", "true")
    await page.screenshot({ path: "/tmp/areza-desktop-restored-layout.png" })
    const panel = page.locator("#review-panel")
    await panel.getByRole("button", { name: "New tab", exact: true }).click()
    await panel.getByRole("button", { name: "Server", exact: true }).click()
    const servers = panel.locator('[data-component="session-servers"]')
    await expect(servers.getByText("vite", { exact: true })).toBeVisible()
    await expect(servers.getByText("project-postgres", { exact: true })).toBeVisible()
    await page.screenshot({ path: "/tmp/areza-project-servers.png" })
    await servers.getByRole("button", { name: "http://localhost:5173" }).click()
    const preview = panel.locator('[data-component="session-browser"]')
    await expect(preview.getByRole("textbox", { name: "Enter a URL" })).toHaveValue("http://localhost:5173/")
    const picker = preview.getByRole("button", { name: "Select a local server" })
    await expect(picker).toHaveText("localhost:5173")
    expect((await picker.boundingBox())!.width).toBeLessThan(256)
    await picker.click()
    await expect(page.getByRole("menuitemradio", { name: "http://localhost:5173" })).toBeVisible()
    await expect(preview.locator('[data-component="browser-preview-snapshot"]')).toBeVisible()
    await expect(preview.locator('[data-component="empty-state"]')).toBeHidden()
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "browserVisible"))).toBe(false)
    await page.screenshot({ path: "/tmp/areza-local-server-menu.png" })
    await page.getByRole("menuitemradio", { name: "http://localhost:5173" }).click()
    await expect(page.getByRole("menu")).toBeHidden()
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "browserVisible"))).toBe(true)
    await expect(preview.locator('[data-component="browser-preview-snapshot"]')).toBeHidden()
    await page.getByRole("button", { name: "Status", exact: true }).click({ timeout: 10000 })
    await expect(preview.locator('[data-component="browser-preview-snapshot"]')).toBeVisible()
    await page.screenshot({ path: "/tmp/areza-browser-other-menu.png" })
    await page.keyboard.press("Escape")
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "browserVisible"))).toBe(true)
    await page.screenshot({ path: "/tmp/areza-local-server-picker.png" })
    await panel.getByRole("tab", { name: "Server", exact: true }).click()
    await servers.locator('[data-service-kind="process"]').getByRole("button", { name: "Stop", exact: true }).click()
    await expect(servers.getByText("vite", { exact: true })).toBeHidden()
    await expect(servers.getByText("project-postgres", { exact: true })).toBeVisible()
    await servers.locator('[data-service-kind="container"]').getByRole("button", { name: "Stop", exact: true }).click()
    await expect(servers.getByText("No running servers or containers found for this project.")).toBeVisible()
    const empty = '[data-component="empty-state"]'
    await expect(servers.locator(empty).getByRole("button")).toHaveCount(0)
    await page.screenshot({ path: "/tmp/areza-server-empty.png" })
    await panel.getByRole("button", { name: "New tab", exact: true }).click()
    await panel.getByRole("button", { name: "Agents", exact: true }).click()
    const agents = panel.locator('[data-component="session-agents"]')
    await expect(agents.getByText("No subagents", { exact: true })).toBeVisible()
    await expect(agents.locator(empty).getByRole("button")).toHaveCount(0)
    await page.screenshot({ path: "/tmp/areza-agents-empty.png" })
    await panel.getByRole("button", { name: "New tab", exact: true }).click()
    await panel.getByRole("button", { name: "Browser", exact: true }).click()
    const browser = panel.locator('[data-component="session-browser"]:visible')
    await expect(browser.getByText("Open a website", { exact: true })).toBeVisible()
    await expect(browser.locator(empty).getByRole("button")).toHaveCount(0)
    await page.screenshot({ path: "/tmp/areza-browser-empty.png" })
    await panel.getByRole("tab", { name: "Server", exact: true }).click()
    await page.evaluate((sessionID) => Reflect.get(window, "openAgentBrowser")(sessionID), fixture.targetID)
    await expect(servers).toBeVisible()
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "browserScope"))).toEqual({ sessionID: fixture.sourceID, directory: fixture.directory })
    await page.evaluate((sessionID) => Reflect.get(window, "openAgentBrowser")(sessionID), fixture.sourceID)
    await expect(browser).toBeVisible()
    await expect(panel.getByRole("tab", { name: "Browser", exact: true })).toHaveCount(1)
    await page.screenshot({ path: "/tmp/areza-agent-browser-tab.png" })
  } finally {
    layout.resolve()
  }
})
