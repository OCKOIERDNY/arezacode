import { expect, test } from "@playwright/test"
import { setupTimelineBenchmark } from "../performance/timeline/session-timeline-benchmark.fixture"

test.use({ colorScheme: "dark" })

test("chat and Context show routing effort, subagent ownership and Headroom history", async ({ page }) => {
  const fixture = await setupTimelineBenchmark(page, { historyTurns: 0, eventBatch: 20, newLayoutDesigns: true })
  const sessionID = "ses_timeline_state_regression"
  const info = { id: "msg_assistant_regression", sessionID, role: "assistant", parentID: "msg_user_regression", modelID: "gpt-6-astra", providerID: "openai", variant: "high", mode: "build", agent: "build", path: { cwd: "C:/OpenCode/TimelineStateRegression", root: "C:/OpenCode/TimelineStateRegression" }, time: { created: 1700000001000, completed: 1700000003000 }, cost: 0.01, tokens: { input: 300, output: 100, reasoning: 20, cache: { read: 600, write: 0 } } }
  const task = { id: "prt_8000_delegate", sessionID, messageID: info.id, type: "tool", callID: "call_delegate", tool: "task", state: { status: "completed", input: { description: "Inspect authentication", subagent_type: "review", prompt: "Check existing login handlers" }, output: "One finding", title: "Inspect authentication", metadata: { sessionId: "ses_child_activity", model: { providerID: "openai", modelID: "gpt-5.6-sol" }, models: [{ providerID: "openai", modelID: "gpt-5.6-sol", variant: "low" }, { providerID: "openai", modelID: "gpt-5.6-terra", variant: "high" }], variant: "low" }, time: { start: 1700000001500, end: 1700000002500 } } }
  await page.route("**/session/ses_child_activity/message*", (route) => route.fulfill({ json: [{ info: { ...info, id: "msg_child_activity", sessionID: "ses_child_activity", modelID: "gpt-5.6-sol", variant: "low" }, parts: [{ ...task, id: "prt_child_read", messageID: "msg_child_activity", sessionID: "ses_child_activity", tool: "read", callID: "call_child_read", state: { ...task.state, input: { filePath: "routes/web.php" }, metadata: {} } }] }] }))
  await page.route("**/api/session/*/usage", (route) => route.fulfill({ json: [
    { id: "msg_activity_model", kind: "model", model: { providerID: "openai", id: "gpt-6-astra", variant: "high" }, time: { created: 1700000001000 }, usage: { version: 1, costSource: "unknown", input: 900, cacheRead: 600 } },
    { id: "msg_activity_jev", kind: "jev", promptID: "msg_user_regression", model: { providerID: "openrouter", id: "~typesafe/jev-latest" }, time: { created: 1700000000000, completed: 1700000000500 }, finish: "stop", decision: { purpose: "routing and skills", outcome: "selected", task: { kind: "review", relation: "followup" }, selected: { providerID: "openai", id: "gpt-6-astra", variant: "high" }, confidence: 0.94, skills: ["az-checklist"] } },
    { id: "msg_activity_headroom", kind: "automation", model: { providerID: "local", id: "headroom" }, time: { created: 1700000002000 }, finish: "compressed", automation: { name: "Headroom", inputCharacters: 12000, outputCharacters: 3000, cached: true } },
  ] }))
  fixture.transport.enqueue([
    { directory: info.path.cwd, payload: { type: "message.updated", properties: { info } } },
    { directory: info.path.cwd, payload: { type: "message.part.updated", properties: { part: task } } },
    { directory: info.path.cwd, payload: { type: "message.part.updated", properties: { part: { id: "prt_9999_text", sessionID, messageID: info.id, type: "text", text: "Found one authentication issue. Verification passed." } } } },
  ])
  await fixture.scrollToBottom()
  const response = page.locator('[data-component="text-part"]').filter({ hasText: "Found one authentication issue." })
  const footer = response.locator('[data-slot="text-part-copy-wrapper"]')
  await expect(footer).toContainText("Orchestrator: gpt-6-astra · high")
  await expect(footer).toContainText("Subagents: gpt-5.6-sol · low")
  await page.mouse.move(0, 0)
  await expect(footer).toHaveCSS("opacity", "0")
  await page.screenshot({ path: "/tmp/areza-model-footer-hidden.png" })
  await response.hover()
  await expect(footer).toHaveCSS("opacity", "1")
  const title = footer.locator('[data-component="overflow-text"]')
  expect((await title.boundingBox())!.width).toBeLessThanOrEqual(480)
  await title.hover()
  await expect.poll(() => title.locator("span").evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m41)).toBeLessThan(0)
  await title.locator("span").evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()))
  await page.screenshot({ path: "/tmp/areza-routing-chat.png" })
  await page.mouse.move(0, 0)
  await expect(footer).toHaveCSS("opacity", "0")
  await expect(title.locator("span")).toHaveCSS("transform", "none")
  const user = page.locator('[data-component="user-message"]')
  const userFooter = user.locator('[data-slot="user-message-copy-wrapper"]')
  await expect(userFooter).toContainText("Claude Opus 4.6")
  await expect(userFooter).toHaveCSS("opacity", "0")
  await user.hover()
  await expect(userFooter).toHaveCSS("opacity", "1")
  expect((await userFooter.locator('[data-component="overflow-text"]').boundingBox())!.width).toBeLessThanOrEqual(320)
  await page.screenshot({ path: "/tmp/areza-user-model-footer-hover.png" })
  fixture.transport.enqueue({ directory: info.path.cwd, payload: { type: "message.updated", properties: { info: {
    id: "msg_user_regression", sessionID, role: "user", time: { created: 1700000000000 }, agent: "build",
    model: { providerID: "openai", modelID: "A long custom model name with extra routing information", variant: "xhigh" },
  } } } })
  await expect(userFooter).toContainText("A long custom model name")
  const userTitle = userFooter.locator('[data-component="overflow-text"]')
  await userTitle.hover()
  await expect.poll(() => userTitle.locator("span").evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m41)).toBeLessThan(0)
  await userTitle.locator("span").evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()))
  await page.screenshot({ path: "/tmp/areza-user-model-footer-long.png" })
  await page.mouse.move(0, 0)
  await footer.getByRole("button", { name: "Copy response", exact: true }).focus()
  await expect(footer).toHaveCSS("opacity", "1")
  await page.emulateMedia({ reducedMotion: "reduce" })
  await title.hover()
  await expect(title.locator("span")).toHaveCSS("transform", "none")
  const routingAction = page.getByTestId("session-jev-action")
  await expect(routingAction).toHaveAttribute("data-prompt-id", "msg_user_regression")
  await expect(routingAction).toContainText("Selected gpt-6-astra · high")
  await expect(routingAction).toContainText("1 call")
  await routingAction.getByRole("button").click()
  await expect(routingAction).toContainText("Review · Follow-up correction")
  await expect(routingAction).toContainText("0.5 sec")
  await page.getByRole("button", { name: "View context usage", exact: true }).click()
  const activity = page.getByTestId("session-model-activity")
  await expect(activity).toContainText("gpt-5.6-sol · low")
  await activity.locator("summary").filter({ hasText: "Jev decisions" }).click()
  await activity.locator("summary").filter({ hasText: "Headroom compression" }).click()
  await expect(activity).toContainText("94%")
  await expect(activity).toContainText("Review · Follow-up correction")
  await expect(page.getByTestId("session-execution-timing")).toContainText("Latest request timing")
  await expect(page.getByTestId("session-execution-timing")).toContainText("0.5 sec")
  await expect(page.getByTestId("session-execution-timing")).toContainText("Question wait")
  await expect(activity).toContainText("9000 saved")
  await expect(activity).toContainText("Reused cached compression")
  await expect(page.getByTestId("session-tool-activity")).toContainText("read · gpt-5.6-sol · low")
  await page.getByTestId("session-tool-activity").locator("summary").filter({ hasText: "read ·" }).click()
  await expect(activity).toContainText("routes/web.php")
  await activity.evaluate((element) => { const viewport = element.closest(".scroll-view__viewport"); if (viewport) viewport.scrollTop = 0 })
  await page.screenshot({ path: "/tmp/areza-routing-context.png" })
})

test("session usage separates inclusive counts, reported charges and unavailable history", async ({ page }) => {
  const fixture = await setupTimelineBenchmark(page, { historyTurns: 2, eventBatch: 1, newLayoutDesigns: true })
  await page.route("**/api/session/*/usage", (route) => route.fulfill({ json: [
    { id: "msg_usage_one", promptID: "msg_prompt_one", model: { providerID: "openrouter", id: "anthropic/claude-sonnet-4" }, time: { created: 1789948800000, completed: 1789948801000 }, finish: "stop", usage: { version: 1, input: 1000, output: 120, reasoning: 20, cacheRead: 600, cacheWrite: 100, total: 1120, cost: 0.012, costSource: "reported", responseID: "gen_example", upstreamCost: 0.01 } },
    { id: "msg_usage_unknown", promptID: "msg_prompt_one", model: { providerID: "openrouter", id: "anthropic/claude-sonnet-4" }, time: { created: 1789948802000, completed: 1789948803000 }, finish: "error", usage: { version: 1, costSource: "unknown" } },
  ] }))
  fixture.transport.enqueue({ directory: "C:/OpenCode/TimelineStateRegression", payload: { type: "message.updated", properties: { info: {
    id: "msg_assistant_regression", sessionID: "ses_timeline_state_regression", role: "assistant", parentID: "msg_user_regression",
    modelID: "claude-opus-4-6", providerID: "opencode", mode: "build", agent: "build", path: { cwd: "C:/OpenCode/TimelineStateRegression", root: "C:/OpenCode/TimelineStateRegression" },
    time: { created: 1700000001000, completed: 1700000002000 }, tokens: { input: 300, output: 100, reasoning: 20, cache: { read: 600, write: 100 } }, cost: 0.012,
    usage: { version: 1, input: 1000, output: 120, reasoning: 20, cacheRead: 600, cacheWrite: 100, total: 1120, cost: 0.012, costSource: "reported" },
  } } } })
  await page.getByRole("button", { name: "View context usage", exact: true }).click()
  const accounting = page.getByTestId("session-usage-accounting")
  await expect(accounting).toBeVisible()
  await expect(accounting).toHaveAttribute("aria-busy", "false")
  await expect(accounting).toContainText("1,120 · 1 unavailable")
  await expect(accounting).toContainText("Uncached input · includes cache writes")
  await expect(accounting).toContainText("400 · 1 unavailable")
  await page.getByRole("button", { name: "View context usage", exact: true }).hover()
  await expect(page.locator('[data-component="context-usage-breakdown"]')).toContainText("Cache read")
  await expect(page.locator('[data-component="context-usage-breakdown"]')).toContainText("400")
  await expect(page.locator('[data-component="context-usage-breakdown"]')).toContainText("600")
  await page.screenshot({ path: "/tmp/areza-token-breakdown-tooltip.png" })
  await accounting.hover()
  await expect(page.locator('[data-component="context-usage-breakdown"]')).not.toBeVisible()
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

test("Tools exposes Context7 without documentation-source setup", async ({ page }) => {
  await setupTimelineBenchmark(page, { historyTurns: 2, eventBatch: 1, newLayoutDesigns: true })
  await page.route("**/pty/shells*", (route) => route.fulfill({ json: [] }))
  const engines = ["markitdown", "headroom", "semgrep", "entire", "context7", "ponytail"].map((id) => ({ id, version: id === "ponytail" ? "native" : "1.0.0", installed: true, managed: true, enabled: true, running: false, rollback: false, storageBytes: 10 * 1024 * 1024 }))
  await page.route("**/api/tools**", async (route) => {
    const url = new URL(route.request().url())
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
  const context7 = tools.getByRole("switch", { name: "Context7", exact: true })
  await expect(context7).toBeChecked()
  await expect(tools.getByText("Documentation sources", { exact: true })).toHaveCount(0)
  await expect(tools.getByText("Grounded Docs", { exact: true })).toHaveCount(0)
  await context7.press("Space")
  await expect(context7).not.toBeChecked()
  await context7.press("Space")
  await expect(context7).toBeChecked()
  await page.screenshot({ path: "/tmp/areza-context7-tools.png" })
})

test("Jev settings, master toggle and automatic/manual model selection", async ({ page }) => {
  const fixture = await setupTimelineBenchmark(page, { historyTurns: 2, eventBatch: 1, newLayoutDesigns: true })
  await page.route("**/api/tools**", (route) => route.fulfill({ json: [] }))
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
  await page.route((url) => url.pathname === "/api/jev", async (route) => {
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
  await expect(settings).toHaveCount(0)
  await page.getByRole("tab", { name: "Tools", exact: true }).click()
  await settings.scrollIntoViewIfNeeded()
  await expect(settings).toHaveCount(1)
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
  await expect(settings).toHaveCount(0)
  await page.screenshot({ path: "/tmp/areza-general-without-jev.png" })
  await page.getByRole("tab", { name: "Tools", exact: true }).click()
  await settings.scrollIntoViewIfNeeded()
  await expect(settings.locator("input[type=password]")).toHaveCount(0)
  await expect(settings.getByRole("switch", { name: "Automatic skill selection" })).toBeChecked()
  await expect(settings.getByText("OpenRouter connection", { exact: true })).toHaveCount(0)
  await expect(settings.getByText("TypeSafe: Jev Latest", { exact: true })).toHaveCount(0)
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
