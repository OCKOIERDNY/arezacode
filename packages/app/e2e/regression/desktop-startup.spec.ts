import { existsSync } from "node:fs"
import { test, expect } from "@playwright/test"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

const renderer = new URL("../../../desktop/out/renderer/", import.meta.url).pathname

test("desktop waits for asynchronous saved layout", async ({ page }) => {
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
    const api: Record<string, unknown> = {
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
        if (key === "settings.v3") return JSON.stringify({ general: { newLayoutDesigns: true } })
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
  } finally {
    layout.resolve()
  }
})
