import { expect, test } from "@playwright/test"
import { setupTimelineBenchmark } from "../performance/timeline/session-timeline-benchmark.fixture"

test.use({ colorScheme: "dark" })

test("session usage separates inclusive counts, reported charges and unavailable history", async ({ page }) => {
  await setupTimelineBenchmark(page, { historyTurns: 2, eventBatch: 1, newLayoutDesigns: true })
  await page.route("**/api/session/*/usage", (route) => route.fulfill({ json: [
    { id: "msg_usage_one", promptID: "msg_prompt_one", model: { providerID: "openrouter", id: "anthropic/claude-sonnet-4" }, time: { created: 1789948800000, completed: 1789948801000 }, finish: "stop", usage: { version: 1, input: 1000, output: 120, reasoning: 20, cacheRead: 600, cacheWrite: 100, total: 1120, cost: 0.012, costSource: "reported", responseID: "gen_example", upstreamCost: 0.01 } },
    { id: "msg_usage_unknown", promptID: "msg_prompt_one", model: { providerID: "openrouter", id: "anthropic/claude-sonnet-4" }, time: { created: 1789948802000, completed: 1789948803000 }, finish: "error", usage: { version: 1, costSource: "unknown" } },
  ] }))
  await page.getByRole("button", { name: "View context usage", exact: true }).click()
  const accounting = page.getByTestId("session-usage-accounting")
  await expect(accounting).toBeVisible()
  await expect(accounting).toHaveAttribute("aria-busy", "false")
  await expect(accounting).toContainText("1,120 · 1 unavailable")
  await expect(accounting).toContainText("$0.012")
  await page.screenshot({ path: "/tmp/areza-final-usage-overview.png" })
  await accounting.locator("summary").filter({ hasText: /^1\./ }).click()
  await expect(accounting).toContainText("gen_example")
  await expect(accounting).toContainText("600")
  await page.screenshot({ path: "/tmp/areza-final-usage.png" })
})

test("Tools keeps the application mounted while loading and reports fetch failures locally", async ({ page }) => {
  await setupTimelineBenchmark(page, { historyTurns: 2, eventBatch: 1, newLayoutDesigns: true })
  await page.route("**/pty/shells*", (route) => route.fulfill({ json: [] }))
  const pending = Promise.withResolvers<void>()
  await page.route("**/api/tools**", async (route) => {
    await pending.promise
    await route.fulfill({ status: 503, json: { error: "Unavailable" } })
  })
  const sidebar = page.locator('[data-component="project-sidebar"]')
  if (!(await sidebar.isVisible())) await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click()
  await sidebar.getByRole("button", { name: "Settings", exact: true }).click()
  const original = await sidebar.elementHandle()
  const requested = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/tools")
  await page.getByRole("tab", { name: "Tools", exact: true }).click()
  await requested
  const tools = page.getByTestId("tools-settings")
  try {
    await expect(sidebar).toBeVisible()
    expect(await original?.evaluate((element) => element.isConnected)).toBe(true)
    await expect(tools).toHaveAttribute("aria-busy", "true")
    await expect(page.getByRole("tab", { name: "Tools", exact: true })).toHaveAttribute("aria-selected", "true")
    await page.screenshot({ path: "/tmp/areza-tools-loading-stable.png" })
  } finally {
    pending.resolve()
  }
  await expect(tools.getByRole("alert")).toBeVisible()
  await expect(tools).toHaveAttribute("aria-busy", "false")
  expect(await original?.evaluate((element) => element.isConnected)).toBe(true)
  await expect(sidebar).toBeVisible()
  await page.screenshot({ path: "/tmp/areza-tools-error-stable.png" })
})

test("Tools keeps its existing rows and sidebar visible during an engine refresh", async ({ page }) => {
  await setupTimelineBenchmark(page, { historyTurns: 2, eventBatch: 1, newLayoutDesigns: true })
  await page.route("**/pty/shells*", (route) => route.fulfill({ json: [] }))
  const pending = Promise.withResolvers<void>()
  const refreshing = Promise.withResolvers<void>()
  let requests = 0
  await page.route("**/api/tools**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/sources")) return route.fulfill({ json: [] })
    requests++
    if (requests > 1) { refreshing.resolve(); await pending.promise }
    await route.fulfill({ json: [{ id: "headroom", version: "0.37.0", installed: true, managed: true, enabled: true, running: requests === 1, rollback: false, storageBytes: 0 }] })
  })
  const sidebar = page.locator('[data-component="project-sidebar"]')
  if (!(await sidebar.isVisible())) await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click()
  await sidebar.getByRole("button", { name: "Settings", exact: true }).click()
  const original = await sidebar.elementHandle()
  await page.getByRole("tab", { name: "Tools", exact: true }).click()
  const tools = page.getByTestId("tools-settings")
  await expect(tools.getByRole("switch", { name: "Headroom", exact: true })).toBeChecked()
  await refreshing.promise
  try {
    await expect(tools).toHaveAttribute("aria-busy", "true")
    await expect(tools.getByRole("switch", { name: "Headroom", exact: true })).toBeChecked()
    await expect(sidebar).toBeVisible()
    expect(await original?.evaluate((element) => element.isConnected)).toBe(true)
    await page.screenshot({ path: "/tmp/areza-tools-refresh-stable.png" })
  } finally {
    pending.resolve()
  }
  await expect(tools).toHaveAttribute("aria-busy", "false")
  await expect(tools.getByRole("button", { name: "Check", exact: true })).toBeEnabled()
  expect(await original?.evaluate((element) => element.isConnected)).toBe(true)
})

test("Tools manages engines and versioned Grounded Docs sources", async ({ page }) => {
  await setupTimelineBenchmark(page, { historyTurns: 2, eventBatch: 1, newLayoutDesigns: true })
  await page.route("**/pty/shells*", (route) => route.fulfill({ json: [] }))
  const engines = ["markitdown", "headroom", "semgrep", "entire", "grounded", "ponytail"].map((id) => ({ id, version: id === "ponytail" ? "native" : "1.0.0", installed: true, managed: true, enabled: true, running: false, rollback: false, storageBytes: 10 * 1024 * 1024 }))
  const sources: { library: string; version: string; url: string; indexedAt: number }[] = []
  await page.route("**/api/tools**", async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith("/sources")) {
      if (route.request().method() === "POST") { sources.push({ ...route.request().postDataJSON(), indexedAt: Date.now() }); return route.fulfill({ json: "Indexed" }) }
      return route.fulfill({ json: sources })
    }
    if (url.pathname.endsWith("/search")) return route.fulfill({ json: "Official documentation excerpt" })
    if (route.request().method() === "POST") {
      const engine = engines.find((item) => url.pathname.endsWith(item.id))!
      engine.enabled = route.request().postDataJSON().action !== "disable"
    }
    return route.fulfill({ json: engines })
  })
  const sidebar = page.locator('[data-component="project-sidebar"]')
  if (!(await sidebar.isVisible())) await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click()
  await sidebar.getByRole("button", { name: "Settings", exact: true }).click()
  await page.getByRole("tab", { name: "Tools", exact: true }).click()
  const tools = page.getByTestId("tools-settings")
  await expect(tools.getByRole("switch", { name: "Headroom", exact: true })).toBeChecked()
  await tools.getByRole("switch", { name: "Headroom", exact: true }).press("Space")
  await expect(tools.getByRole("switch", { name: "Headroom", exact: true })).not.toBeChecked()
  await page.screenshot({ path: "/tmp/areza-tools-settings.png" })
  await tools.getByRole("textbox", { name: "Library name", exact: true }).fill("bun")
  await tools.getByRole("textbox", { name: "Library version", exact: true }).fill("1.3.14")
  await tools.getByRole("textbox", { name: "Official documentation URL", exact: true }).fill("https://bun.sh/docs/")
  await tools.getByRole("button", { name: "Index source", exact: true }).click()
  await expect(tools.getByText("bun 1.3.14", { exact: true })).toBeVisible()
  await tools.getByRole("textbox", { name: "Search indexed documentation", exact: true }).fill("binary data")
  await tools.getByRole("button", { name: "Search", exact: true }).click()
  await expect(tools.getByRole("status")).toContainText("Official documentation excerpt")
  await page.screenshot({ path: "/tmp/areza-grounded-settings.png" })
})

test("Jev settings, master toggle and automatic/manual model selection", async ({ page }) => {
  const fixture = await setupTimelineBenchmark(page, { historyTurns: 2, eventBatch: 1, newLayoutDesigns: true })
  await page.route("**/pty/shells*", (route) =>
    route.fulfill({ json: [], headers: { "access-control-allow-origin": "*" } }),
  )
  const state = { enabled: false, skills: true, context: true, findings: true, routing: true, configured: true }
  await page.route((url) => url.pathname === "/provider", (route) => route.fulfill({
    json: {
      all: [
        { id: "opencode", name: "OpenCode", models: { "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } } } },
        { id: "openrouter", name: "OpenRouter", models: {} },
      ],
      connected: ["opencode", ...(state.configured ? ["openrouter"] : [])],
      default: { providerID: "opencode", modelID: "claude-opus-4-6" },
    },
    headers: { "access-control-allow-origin": "*" },
  }))
  await page.route("**/api/jev", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON()
      expect(body).not.toHaveProperty("apiKey")
      Object.assign(state, body)
    }
    await route.fulfill({
      json: state,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "GET,PATCH,POST,OPTIONS",
      },
    })
  })
  await page.reload()
  const toggle = page.locator('[data-action="prompt-jev"]')
  await expect(page.locator('[data-action="prompt-model"]')).toBeVisible()
  await expect(toggle).toHaveCount(0)
  await page.locator('[data-action="prompt-model"]').click()
  await expect(page.getByPlaceholder("Search models")).toBeVisible()
  await expect(page.getByRole("menuitemradio", { name: "Auto Jev" })).toHaveCount(0)
  await page.keyboard.press("Escape")
  const sidebar = page.locator('[data-component="project-sidebar"]')
  if (!(await sidebar.isVisible())) await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click()
  await sidebar.getByRole("button", { name: "Settings", exact: true }).click()
  const settings = page.getByTestId("jev-settings")
  await expect(page.getByRole("tab", { name: "General", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect(settings).toHaveCount(0)
  await page.screenshot({ path: "/tmp/areza-jev-general-disabled.png" })
  await page.getByRole("tab", { name: "Models", exact: true }).click()
  await page.getByRole("searchbox", { name: "Search models" }).fill("jev")
  await page.getByRole("switch", { name: "TypeSafe: Jev Latest", exact: true }).press("Space")
  await expect(page.getByRole("switch", { name: "TypeSafe: Jev Latest", exact: true })).toBeChecked()
  await page.keyboard.press("Escape")
  await expect(toggle).toBeEnabled()
  await expect(toggle).toHaveAttribute("aria-pressed", "true")
  await page.locator('[data-action="prompt-model"]').click()
  await page.getByPlaceholder("Search models").fill("jev")
  await expect(page.locator('[data-slot="jev-model-info"]')).toContainText("TypeSafe: Jev Latest")
  await page.screenshot({ path: "/tmp/areza-jev-decision-discovery.png" })
  await page.getByRole("menuitemradio", { name: "Auto Jev" }).click()
  await expect(page.locator('[data-action="prompt-model"]')).toContainText("Auto")
  await page.screenshot({ path: "/tmp/areza-jev-chat.png" })
  await page.locator('[data-action="prompt-model"]').click()
  await page.getByRole("menuitemradio", { name: /Claude Opus 4.6/ }).click()
  await expect(page.locator('[data-action="prompt-model"]')).toContainText("Claude Opus 4.6")
  await toggle.click()
  await expect(toggle).toHaveCount(0)
  await page.screenshot({ path: "/tmp/areza-jev-chat-disabled.png" })
  await sidebar.getByRole("button", { name: "Settings", exact: true }).click()
  await page.getByRole("tab", { name: "Models", exact: true }).click()
  await page.getByRole("searchbox", { name: "Search models" }).fill("openrouter")
  const provider = page.locator('[data-component="settings-models-provider"]').filter({ hasText: "OpenRouter" })
  const modelSwitch = provider.getByRole("switch", { name: "TypeSafe: Jev Latest", exact: true })
  await expect(modelSwitch).toBeEnabled()
  await expect(modelSwitch).not.toBeChecked()
  await modelSwitch.press("Space")
  await expect(modelSwitch).toBeChecked()
  await page.screenshot({ path: "/tmp/areza-jev-openrouter-models.png" })
  await page.getByRole("tab", { name: "General", exact: true }).click()
  await settings.scrollIntoViewIfNeeded()
  await expect(settings.getByRole("switch", { name: "Enable all configured Jev features" })).toBeChecked()
  await settings.getByRole("switch", { name: "Enable all configured Jev features" }).press("Space")
  await expect(settings).toHaveCount(0)
  await expect(toggle).toHaveCount(0)
  await page.getByRole("tab", { name: "Models", exact: true }).click()
  await page.getByRole("searchbox", { name: "Search models" }).fill("jev")
  await expect(modelSwitch).not.toBeChecked()
  await modelSwitch.press("Space")
  await expect(modelSwitch).toBeChecked()
  await page.getByRole("tab", { name: "General", exact: true }).click()
  await settings.scrollIntoViewIfNeeded()
  await expect(settings.locator("input[type=password]")).toHaveCount(0)
  await expect(settings.getByRole("switch", { name: "Automatic skill selection" })).toBeChecked()
  await expect(settings.getByText("Uses your OpenRouter connection from Providers", { exact: true })).toBeVisible()
  await page.screenshot({ path: "/tmp/areza-jev-settings.png" })
  await settings.getByRole("switch", { name: "Relevant context selection" }).press("Space")
  await expect(settings.getByRole("switch", { name: "Relevant context selection" })).not.toBeChecked()
  state.configured = false
  fixture.transport.enqueue({ directory: "global", payload: { type: "integration.connection.updated", properties: {} } })
  await expect(toggle).toHaveCount(0)
  await expect(settings).toHaveCount(0)
  state.configured = true
  fixture.transport.enqueue({ directory: "global", payload: { type: "integration.connection.updated", properties: {} } })
  await expect(toggle).toBeAttached()
  state.configured = false
  await page.reload()
  await expect(page.locator('[data-action="prompt-model"]')).toBeVisible()
  await expect(toggle).toHaveCount(0)
  await page.screenshot({ path: "/tmp/areza-jev-disconnected.png" })
})
