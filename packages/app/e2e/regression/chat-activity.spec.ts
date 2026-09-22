import { expect, test } from "@playwright/test"
import { buildInitialStreamEvent, buildStreamDeltaEvents, setupTimelineBenchmark } from "../performance/timeline/session-timeline-benchmark.fixture"

test.use({ colorScheme: "dark" })

test("todo overflow uses the shared content fade at both scroll edges", async ({ page }) => {
  const fixture = await setupTimelineBenchmark(page, { historyTurns: 1, eventBatch: 1, newLayoutDesigns: true })
  const directory = "C:/OpenCode/TimelineStateRegression"
  const sessionID = "ses_timeline_state_regression"
  const todos = [
    { content: "Fix read-only link handling, protected redemption, isolated throttles, and asynchronous delivery", status: "completed", priority: "high" },
    { content: "Split auth screens and hooks and fix the frontend response handling and cross-tab handoff", status: "completed", priority: "high" },
    { content: "Add regression coverage for account switching and the token expiry boundary", status: "completed", priority: "high" },
    { content: "Verify the shared UI components and run the production build", status: "in_progress", priority: "high" },
    { content: "Review the final changes and summarize the remaining findings", status: "pending", priority: "high" },
    { content: "Check the questionnaire keyboard submission", status: "pending", priority: "high" },
    { content: "Confirm the draft survives the questionnaire", status: "pending", priority: "high" },
    { content: "Verify the viewport remains visible throughout submission", status: "pending", priority: "high" },
    { content: "Inspect the final rendered interface", status: "pending", priority: "high" },
  ]
  await page.route(`**/session/${sessionID}/todo**`, (route) => route.fulfill({ json: todos, headers: { "access-control-allow-origin": "*" } }))
  await page.route("**/session/status**", (route) => route.fulfill({ json: { [sessionID]: { type: "busy" } }, headers: { "access-control-allow-origin": "*" } }))
  fixture.transport.enqueue({ directory, payload: {
    type: "session.status", properties: { sessionID, status: { type: "busy" } },
  } })
  fixture.transport.enqueue({ directory, payload: { type: "todo.updated", properties: { sessionID, todos } } })
  const dock = page.locator('[data-component="session-todo-dock"]')
  const scroll = dock.locator('.scroll-view--fade')
  const viewport = scroll.locator('.scroll-view__viewport')
  await expect(dock).toBeVisible()
  await expect(scroll).toHaveAttribute("data-scroll-below", "true")
  await expect(scroll).not.toHaveAttribute("data-scroll-above")
  expect(await viewport.evaluate((element) => getComputedStyle(element).maskImage)).toContain("linear-gradient")
  await page.screenshot({ path: "/tmp/areza-todo-fade-top.png" })
  await viewport.evaluate((element) => { element.scrollTop = (element.scrollHeight - element.clientHeight) / 2 })
  await expect(scroll).toHaveAttribute("data-scroll-above", "true")
  await expect(scroll).toHaveAttribute("data-scroll-below", "true")
  await page.screenshot({ path: "/tmp/areza-todo-fade-middle.png" })
  await viewport.evaluate((element) => { element.scrollTop = element.scrollHeight })
  await expect(scroll).not.toHaveAttribute("data-scroll-below")
  await page.screenshot({ path: "/tmp/areza-todo-fade-bottom.png" })
})

test("tool rows use compact spacing, distinct icons and hover contrast", async ({ page }) => {
  const fixture = await setupTimelineBenchmark(page, { historyTurns: 2, eventBatch: 1, newLayoutDesigns: true })
  for (const [index, tool] of ["shell", "read", "grep", ...Array.from({ length: 12 }, () => "shell")].entries()) {
    fixture.transport.enqueue({ directory: "C:/OpenCode/TimelineStateRegression", payload: {
      type: "message.part.updated",
      properties: { part: {
        id: `prt_800${String(index).padStart(2, "0")}_polish`, sessionID: "ses_timeline_state_regression", messageID: "msg_assistant_regression",
        type: "tool", callID: `call_polish_${index}`, tool,
        state: { status: "completed", input: { command: "bun typecheck", filePath: "src/example.ts", pattern: "shared" }, output: "Done", title: "Done", metadata: {}, time: { start: 1700000001000, end: 1700000002000 } },
      } },
    } })
  }
  const group = page.locator('[data-component="context-tool-group-trigger"]').last()
  await expect(group).toContainText("Used tools")
  await fixture.scrollToBottom()
  const groupTop = (await group.boundingBox())!.y
  await group.click()
  await expect.poll(async () => (await group.boundingBox())?.y ?? -1).toBeCloseTo(groupTop, 0)
  const shells = page.locator('[data-component="tool-trigger"]').filter({ hasText: "Shell" })
  await expect(shells).toHaveCount(13)
  const shell = shells.last()
  await expect(shell).toBeVisible()
  await fixture.scrollToBottom()
  await shells.first().click()
  await shell.click()
  await fixture.scrollToBottom()
  await expect(shell.locator('[data-slot="basic-tool-tool-indicator"] svg')).toBeVisible()
  const title = shell.locator('[data-slot="basic-tool-tool-title"]')
  await shell.evaluate((element) => element.closest<HTMLElement>('[data-slot="collapsible-trigger"]')?.blur())
  await page.mouse.move(0, 0)
  await expect(title).toHaveCSS("color", await shell.evaluate((element) => getComputedStyle(element).color))
  const normal = await title.evaluate((element) => getComputedStyle(element).color)
  await shell.hover()
  await expect.poll(() => title.evaluate((element) => getComputedStyle(element).color)).not.toBe(normal)
  const row = shell.locator('xpath=ancestor::*[@data-timeline-row="AssistantPart"]')
  expect(await row.evaluate((element) => parseFloat(getComputedStyle(element).paddingTop))).toBeLessThanOrEqual(2)
  await page.screenshot({ path: "/tmp/areza-compact-tools-hover.png" })
  const scroll = page.locator('[data-component="tool-group-scroll"]').last()
  const viewport = scroll.locator('.scroll-view__viewport')
  expect((await scroll.boundingBox())!.height).toBeLessThanOrEqual(320)
  expect(await viewport.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  await viewport.evaluate((element) => { element.scrollTop = 0 })
  await expect(scroll).toHaveAttribute("data-scroll-below", "true")
  await expect(scroll).not.toHaveAttribute("data-scroll-above")
  expect(await viewport.evaluate((element) => getComputedStyle(element).maskImage)).toContain("linear-gradient")
  const outer = await page.locator('.message-timeline-scroll > .scroll-view__viewport').evaluate((element) => element.scrollTop)
  await viewport.hover()
  await page.mouse.wheel(0, 300)
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  await expect(scroll).toHaveAttribute("data-scroll-above", "true")
  expect(await page.locator('.message-timeline-scroll > .scroll-view__viewport').evaluate((element) => element.scrollTop)).toBeCloseTo(outer, 0)
  await expect(scroll.locator('.scroll-view__thumb')).toBeVisible()
  await page.screenshot({ path: "/tmp/areza-compact-tools-expanded.png" })
  await group.click()
  await expect(scroll).toBeHidden()
  await page.screenshot({ path: "/tmp/areza-compact-tools-grouped.png" })
  fixture.transport.enqueue({ directory: "C:/OpenCode/TimelineStateRegression", payload: {
    type: "session.status", properties: { sessionID: "ses_timeline_state_regression", status: { type: "busy" } },
  } })
  fixture.transport.enqueue({ directory: "C:/OpenCode/TimelineStateRegression", payload: {
    type: "message.part.updated",
    properties: { part: {
      id: "prt_80014_polish", sessionID: "ses_timeline_state_regression", messageID: "msg_assistant_regression",
      type: "tool", callID: "call_polish_14", tool: "shell",
      state: { status: "error", input: { command: "bun typecheck" }, error: "Typecheck failed", time: { start: 1700000001000, end: 1700000002000 } },
    } },
  } })
  await expect(group.locator('[data-component="tool-count-label"]').last()).toContainText("failed")
  await expect(group.locator('[data-component="tool-count-label"]').last().locator('[data-component="animated-number"]')).toHaveAttribute("aria-label", "1")
  await group.click()
  const error = page.locator('[data-kind="tool-error-card"]')
  const errorTrigger = error.locator('[data-slot="collapsible-trigger"]')
  const normalTrigger = shells.first().locator('xpath=ancestor::*[@data-slot="collapsible-trigger"]')
  expect((await errorTrigger.boundingBox())!.height).toBe((await normalTrigger.boundingBox())!.height)
  const indicator = '[data-slot="basic-tool-tool-indicator"]'
  expect((await error.locator(indicator).boundingBox())!.x).toBe((await shells.first().locator(indicator).boundingBox())!.x)
  expect(await error.locator('[data-slot="basic-tool-tool-title"]').evaluate((el) => getComputedStyle(el).fontSize))
    .toBe(await shells.first().locator('[data-slot="basic-tool-tool-title"]').evaluate((el) => getComputedStyle(el).fontSize))
  if (await errorTrigger.getAttribute("aria-expanded") === "false") await errorTrigger.click()
  await expect(error).toContainText("Typecheck failed")
  expect(await error.evaluate((element) => getComputedStyle(element, "::before").content)).toBe("none")
  await expect(error.locator('[data-component="tool-error-card-icon"]')).toBeVisible()
  await page.screenshot({ path: "/tmp/areza-tool-error-no-line.png" })
  await errorTrigger.click()
  await shells.first().click()
  await expect(errorTrigger).toHaveAttribute("aria-expanded", "false")
  await viewport.evaluate((element) => { element.scrollTop = element.scrollHeight })
  expect((await error.boundingBox())!.height).toBe((await normalTrigger.boundingBox())!.height)
  await page.screenshot({ path: "/tmp/areza-tool-error-alignment.png" })
})

test("expanded patch headers scroll with their tool group", async ({ page }) => {
  const fixture = await setupTimelineBenchmark(page, { historyTurns: 2, eventBatch: 1, newLayoutDesigns: true })
  const files = ["src/first.ts", "src/second.ts"].map((filePath) => ({
    filePath, relativePath: filePath, type: "update", additions: 40, deletions: 40,
    before: Array.from({ length: 40 }, (_, index) => `export const value${index} = ${index}\n`).join(""),
    after: Array.from({ length: 40 }, (_, index) => `export const value${index} = ${index + 1}\n`).join(""),
  }))
  fixture.transport.enqueue({ directory: "C:/OpenCode/TimelineStateRegression", payload: {
    type: "message.part.updated", properties: { part: {
      id: "prt_90000_scroll_patch", sessionID: "ses_timeline_state_regression", messageID: "msg_assistant_regression",
      type: "tool", callID: "call_scroll_patch", tool: "apply_patch",
      state: { status: "completed", input: { files: files.map((file) => file.filePath) }, output: "Done", title: "Done", metadata: { files }, time: { start: 1700000001000, end: 1700000002000 } },
    } },
  } })
  const group = page.locator('[data-component="context-tool-group-trigger"]').last()
  await expect(group).toContainText("Used tools")
  await fixture.scrollToBottom()
  await group.click()
  const patch = page.locator('[data-component="apply-patch-tool"]').last()
  const trigger = patch.locator('[data-slot="collapsible-trigger"]').first()
  if (await trigger.getAttribute("aria-expanded") === "false") await trigger.click()
  const header = patch.locator('[data-component="sticky-accordion-header"]').first()
  await expect(header).toBeVisible()
  await expect(trigger).toHaveCSS("position", "static")
  await expect(header).toHaveCSS("position", "static")
  await fixture.scrollToBottom()
  const viewport = page.locator('[data-component="tool-group-scroll"]').last().locator('.scroll-view__viewport')
  await viewport.evaluate((element) => { element.scrollTop = 0 })
  const top = (await header.boundingBox())!.y
  await page.screenshot({ path: "/tmp/areza-tool-headers-top.png" })
  await viewport.evaluate((element) => { element.scrollTop = 160 })
  await expect.poll(async () => top - (await header.boundingBox())!.y).toBeCloseTo(160, 0)
  await page.screenshot({ path: "/tmp/areza-tool-headers-scrolled.png" })
})

test("keeps the review sidebar mounted when committed changes disappear", async ({ page }) => {
  const diffs = [{ file: "src/committed.ts", before: "before\n", after: "after\n", status: "modified", additions: 1, deletions: 1 }]
  const fixture = await setupTimelineBenchmark(page, { historyTurns: 3, eventBatch: 1, newLayoutDesigns: true, vcsDiff: diffs })
  await page.locator('[aria-controls="review-panel"]').click()
  const sidebar = page.locator('[data-slot="session-review-v2-sidebar"]')
  const review = page.locator('#review-panel [data-component="session-review-v2"]')
  await expect(sidebar.getByRole("button", { name: "committed.ts", exact: true })).toBeVisible()
  await page.locator('[data-component="prompt-input"]').fill("Ready to send")
  await page.screenshot({ path: "/tmp/areza-lighter-chat-send.png" })
  await sidebar.evaluate((element) => element.setAttribute("data-mount-probe", "original"))
  await review.evaluate((element) => element.setAttribute("data-mount-probe", "original"))
  await page.addStyleTag({ content: '[data-slot="review-diffs-content"] { transition-duration: 600ms !important; }' })
  diffs.splice(0)
  fixture.transport.enqueue({ directory: "C:/OpenCode/TimelineStateRegression", payload: { type: "filesystem.changed", properties: { file: "src/committed.ts" } } })
  const outgoing = sidebar.locator('[data-slot="review-diffs-content"]')
  await expect(outgoing).toHaveAttribute("data-exiting", "true")
  await expect(sidebar.getByRole("button", { name: "committed.ts", exact: true })).toHaveCount(1)
  await expect.poll(() => outgoing.evaluate((element) => Number(getComputedStyle(element).opacity))).toBeLessThan(0.9)
  expect(await outgoing.evaluate((element) => getComputedStyle(element).transform)).not.toBe("matrix(1, 0, 0, 1, 0, 0)")
  await page.screenshot({ path: "/tmp/areza-commit-exit.png" })
  await expect(sidebar.getByRole("button", { name: "committed.ts", exact: true })).toHaveCount(0)
  await expect(sidebar).toHaveAttribute("data-mount-probe", "original")
  await expect(review).toHaveAttribute("data-mount-probe", "original")
  await expect(page.locator('[data-component="session-right-panel"]')).toHaveAttribute("data-opened", "true")
  await page.screenshot({ path: "/tmp/areza-commit-empty.png" })
  diffs.push({ file: "src/committed.ts", before: "before\n", after: "after\n", status: "modified", additions: 1, deletions: 1 })
  fixture.transport.enqueue({ directory: "C:/OpenCode/TimelineStateRegression", payload: { type: "filesystem.changed", properties: { file: "src/committed.ts" } } })
  await expect(sidebar.getByRole("button", { name: "committed.ts", exact: true })).toBeVisible()
  diffs.splice(0)
  fixture.transport.enqueue({ directory: "C:/OpenCode/TimelineStateRegression", payload: { type: "filesystem.changed", properties: { file: "src/committed.ts" } } })
  await expect(outgoing).toHaveAttribute("data-exiting", "true")
  diffs.push({ file: "src/committed.ts", before: "before\n", after: "newer\n", status: "modified", additions: 1, deletions: 1 })
  fixture.transport.enqueue({ directory: "C:/OpenCode/TimelineStateRegression", payload: { type: "filesystem.changed", properties: { file: "src/committed.ts" } } })
  await expect(outgoing).toHaveAttribute("data-exiting", "false")
  await expect.poll(() => outgoing.evaluate((element) => getComputedStyle(element).opacity)).toBe("1")
  await expect(sidebar.getByRole("button", { name: "committed.ts", exact: true })).toBeVisible()
  await page.emulateMedia({ reducedMotion: "reduce" })
  diffs.splice(0)
  fixture.transport.enqueue({ directory: "C:/OpenCode/TimelineStateRegression", payload: { type: "filesystem.changed", properties: { file: "src/committed.ts" } } })
  await expect(sidebar.getByRole("button", { name: "committed.ts", exact: true })).toHaveCount(0)
  await expect(outgoing).toHaveAttribute("data-exiting", "false")
  await expect(sidebar).toHaveAttribute("data-mount-probe", "original")
})

test("resizing paints the latest pointer position once per frame and preserves the release position", async ({ page }) => {
  await setupTimelineBenchmark(page, { historyTurns: 3, eventBatch: 1, newLayoutDesigns: true })
  const sidebar = page.locator('[data-component="project-sidebar"]')
  if (!(await sidebar.isVisible())) await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click()
  const handle = sidebar.getByRole("separator")
  const result = await handle.evaluate(async (element) => {
    const slot = element.closest<HTMLElement>('[data-component="project-sidebar-slot"]')!
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const startWidth = slot.getBoundingClientRect().width
    const startX = element.getBoundingClientRect().x
    const delta = startWidth > 300 ? -60 : 60
    let writes = 0
    const observer = new MutationObserver((records) => (writes += records.length))
    observer.observe(slot, { attributes: true, attributeFilter: ["style"] })
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: startX }))
    for (let index = 1; index <= 100; index++) {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: startX + (delta * index) / 100 }))
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const painted = slot.getBoundingClientRect().width
    const frameWrites = writes
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: startX + delta / 2 }))
    document.dispatchEvent(new MouseEvent("mouseup"))
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    observer.disconnect()
    return { startWidth, delta, painted, frameWrites, released: parseFloat(slot.style.width), dragging: element.getAttribute("data-dragging") }
  })
  expect(result.frameWrites).toBeLessThanOrEqual(1)
  expect(result.painted).toBeCloseTo(result.startWidth + result.delta, 0)
  expect(result.released).toBeCloseTo(result.startWidth + result.delta / 2, 0)
  expect(result.dragging).toBe("false")
  await page.screenshot({ path: "/tmp/areza-resize-frame-budget.png" })
})

test("smoothly returns to the bottom and resumes following, with a reduced-motion fallback", async ({ page }) => {
  const fixture = await setupTimelineBenchmark(page, { historyTurns: 12, eventBatch: 1, newLayoutDesigns: true, vcsDiff: [{ file: "src/chat.tsx", additions: 12, deletions: 3 }] })
  const latest = page.locator('[data-slot="chat-latest"]')
  await fixture.scrollToBottom()
  await fixture.scroller.hover()
  await page.mouse.wheel(0, -1600)
  await expect(latest).toBeVisible()
  await expect(latest).toHaveCSS("opacity", "1")
  await expect(latest).toHaveCSS("border-top-width", "0px")
  await expect(page.locator('[data-slot="chat-changes"]')).toHaveCSS("border-top-width", "0px")
  await page.screenshot({ path: "/tmp/areza-smooth-scroll-before.png" })
  const positions = await latest.evaluate((button) => {
    const root = document.querySelector<HTMLElement>(".message-timeline-scroll .scroll-view__viewport")!
    const start = root.scrollTop
    ;(button as HTMLButtonElement).click()
    return new Promise<number[]>((resolve, reject) => {
      const samples = [start]
      const deadline = performance.now() + 3000
      const sample = () => {
        samples.push(root.scrollTop)
        if (root.scrollHeight - root.clientHeight - root.scrollTop < 3) return resolve(samples)
        if (performance.now() > deadline) return reject(new Error("Smooth scroll did not reach the bottom"))
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
  })
  expect(new Set(positions.filter((top) => top > positions[0]! && top < positions.at(-1)!)).size).toBeGreaterThan(3)
  await expect(latest).toHaveCSS("transition-duration", "0.16s, 0.16s, 0.16s")
  await expect(latest).toBeHidden()
  await expect(latest).toHaveAttribute("tabindex", "-1")
  await page.screenshot({ path: "/tmp/areza-smooth-scroll-after.png" })
  fixture.transport.enqueue(buildInitialStreamEvent(30))
  fixture.transport.enqueue(buildStreamDeltaEvents(30))
  await expect(fixture.text).toContainText("benchmark-complete")
  await expect.poll(() => fixture.scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(3)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await expect(latest).toHaveCSS("transition-duration", "0s")
  await expect(fixture.scroller).toHaveCSS("overscroll-behavior-y", "none")
  await fixture.scroller.hover()
  await page.mouse.wheel(0, -1600)
  await expect(latest).toBeVisible()
  const distance = await latest.evaluate((button) => {
    ;(button as HTMLButtonElement).click()
    const root = document.querySelector<HTMLElement>(".message-timeline-scroll .scroll-view__viewport")!
    return root.scrollHeight - root.clientHeight - root.scrollTop
  })
  expect(distance).toBeLessThan(3)
})

test("swaps the sidebars from settings and keeps resize directions correct", async ({ page }) => {
  await setupTimelineBenchmark(page, {
    historyTurns: 3,
    eventBatch: 1,
    newLayoutDesigns: true,
    vcsDiff: [{ file: "src/example.ts", status: "modified", additions: 2, deletions: 1 }],
  })
  await page.route("**/pty/shells*", (route) => route.fulfill({ json: [] }))
  const sidebar = page.locator('[data-component="project-sidebar"]')
  if (!(await sidebar.isVisible())) await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click()
  await sidebar.getByRole("button", { name: "Settings", exact: true }).click()
  const position = page.locator('[data-action="settings-sidebar-position"]')
  await position.click()
  await page.locator('[data-component="menu-v2-item"]').filter({ hasText: "Right" }).click({ timeout: 5000 })
  await expect(position).toContainText("Right")
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("settings.v3")!).general.sidebarPosition)).toBe("right")
  await page.screenshot({ path: "/tmp/areza-sidebar-position-settings.png" })
  await page.keyboard.press("Escape")
  const chat = page.locator('[data-component="session-chat-panel"]')
  await expect.poll(async () => (await sidebar.boundingBox())!.x > (await chat.boundingBox())!.x).toBe(true)
  const handle = sidebar.getByRole("separator")
  await expect(handle).toHaveAttribute("data-edge", "start")
  const before = (await sidebar.boundingBox())!.width
  await handle.focus()
  await page.keyboard.press("ArrowLeft")
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBe(before + 16)
  await page.locator('[data-slot="chat-changes"]').hover()
  await page.locator('[data-component="chat-changes-preview"]').getByRole("button").click()
  const files = page.locator('[data-component="session-right-panel"]')
  await expect(files).toHaveAttribute("data-opened", "true")
  await expect.poll(async () => (await files.boundingBox())!.x < (await chat.boundingBox())!.x).toBe(true)
  const divider = page.locator('[data-panel-resize="session"]')
  await expect(divider).toHaveAttribute("data-edge", "start")
  await expect.poll(() => chat.evaluate((el) => el.getAnimations().length)).toBe(0)
  await expect.poll(() => files.evaluate((el) => el.getAnimations().length)).toBe(0)
  const bounds = (await divider.boundingBox())!
  const width = (await chat.boundingBox())!.width
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 80)
  await page.mouse.down()
  await expect(divider).toHaveAttribute("data-dragging", "true")
  await page.mouse.move(bounds.x + bounds.width / 2 - 40, bounds.y + 80, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => (await chat.boundingBox())!.width).toBeGreaterThan(width + 30)
  const collapseChat = async (side: "left" | "right") => {
    await expect.poll(() => chat.evaluate((el) => el.getAnimations().length)).toBe(0)
    const handle = (await divider.boundingBox())!
    const currentWidth = (await chat.boundingBox())!.width
    const direction = side === "right" ? 1 : -1
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 80)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2 + direction * (currentWidth - 300), handle.y + 80, { steps: 8 })
    await expect(chat).toHaveCSS("width", "320px")
    await page.mouse.up()
    await expect(chat).toHaveCSS("width", "320px")
    await page.screenshot({ path: `/tmp/areza-chat-narrow-${side}.png` })
    const narrow = (await divider.boundingBox())!
    const origin = narrow.x + narrow.width / 2
    await page.mouse.move(origin, narrow.y + 80)
    await page.mouse.down()
    await page.mouse.move(origin + direction * 70, narrow.y + 80, { steps: 4 })
    await expect(chat).toHaveCSS("width", "320px")
    await page.mouse.move(origin + direction * 100, narrow.y + 80)
    await expect(chat).toHaveAttribute("data-collapsed", "true")
    const midway = await chat.evaluate((element) => {
      const animation = element.getAnimations().find((item) => item instanceof CSSTransition && item.transitionProperty === "width")
      if (!animation) throw new Error("Chat collapsed without a width transition")
      for (const panel of element.parentElement!.querySelectorAll('[data-component="session-chat-panel"], [data-component="session-right-panel"], [data-slot="session-chat-content"]')) {
        for (const transition of panel.getAnimations()) {
          transition.pause()
          transition.currentTime = 80
        }
      }
      for (const transition of element.parentElement!.getAnimations()) {
        transition.pause()
        transition.currentTime = 80
      }
      return element.getBoundingClientRect().width
    })
    expect(midway).toBeGreaterThan(0)
    expect(midway).toBeLessThan(320)
    const chatBounds = (await chat.boundingBox())!
    const fileBounds = (await files.boundingBox())!
    const gap = side === "left" ? fileBounds.x - chatBounds.x - chatBounds.width : chatBounds.x - fileBounds.x - fileBounds.width
    expect(gap).toBeGreaterThanOrEqual(-1)
    expect(gap).toBeLessThanOrEqual(17)
    await page.screenshot({ path: `/tmp/areza-chat-collapsing-${side}.png` })
    await chat.evaluate((element) => element.parentElement!.getAnimations({ subtree: true }).forEach((animation) => {
      if (animation instanceof CSSTransition) animation.finish()
    }))
    await expect(chat).toHaveCSS("width", "0px")
    await page.mouse.move(origin + direction * 40, narrow.y + 80)
    await expect(chat).toHaveCSS("width", "0px")
    await page.mouse.move(origin, narrow.y + 80)
    await expect(chat).toHaveCSS("width", "320px")
    await page.mouse.move(origin + direction * 100, narrow.y + 80)
    await page.mouse.up()
    await expect(chat).toHaveCSS("width", "0px")
    await expect(files).toBeVisible()
    await page.screenshot({ path: `/tmp/areza-chat-collapsed-${side}.png` })
    await page.getByRole("button", { name: "Show chat", exact: true }).click()
    await expect(chat).toHaveCSS("width", "600px")
  }
  await collapseChat("right")
  await page.screenshot({ path: "/tmp/areza-sidebars-swapped.png" })
  const projectsToggle = page.locator('[aria-controls="project-sidebar"]')
  const filesToggle = page.locator('[aria-controls="review-panel"]')
  await expect.poll(async () => (await filesToggle.boundingBox())!.x < (await projectsToggle.boundingBox())!.x).toBe(true)
  const checkClosedPanel = async (side: string) => {
    const handle = (await divider.boundingBox())!
    const width = (await files.boundingBox())!.width
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 80)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2 + (side === "right" ? -1 : 1) * (width - 150), handle.y + 80, { steps: 8 })
    await page.mouse.up()
    await expect(files).toHaveAttribute("data-opened", "false")
    await filesToggle.click()
    await expect(files).toBeVisible()
    await expect.poll(() => chat.evaluate((element) => element.getAnimations().length)).toBe(0)
    const expandedWidth = (await files.boundingBox())!.width
    await files.evaluate((element) => element.setAttribute("data-mount-probe", "original"))
    const motion = await filesToggle.evaluate(async (element) => {
      ;(element as HTMLButtonElement).click()
      await new Promise(requestAnimationFrame)
      const panels = document.querySelectorAll('[data-component="session-panel-row"], [data-component="session-chat-panel"], [data-component="session-right-panel"]')
      return Array.from(panels).flatMap((panel) => panel.getAnimations().filter((animation) => animation.effect!.getTiming().duration === 200).map((animation) => {
        animation.pause()
        animation.currentTime = 50
        return { duration: animation.effect!.getTiming().duration, easing: animation.effect!.getTiming().easing }
      }))
    })
    expect(motion.length).toBeGreaterThanOrEqual(3)
    for (const animation of motion) expect(animation).toEqual({ duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" })
    expect((await files.boundingBox())!.width).toBeCloseTo(expandedWidth, 0)
    expect((await page.locator('[data-component="session-right-panel-slot"]').boundingBox())!.width).toBeLessThan(expandedWidth)
    await page.screenshot({ path: `/tmp/areza-${side}-files-closing.png` })
    await filesToggle.click()
    await expect(files).toHaveAttribute("data-opened", "true")
    await expect(files).toHaveAttribute("data-mount-probe", "original")
    await page.evaluate(() => document.getAnimations().forEach((animation) => animation.play()))
    await expect.poll(() => chat.evaluate((element) => element.getAnimations().length)).toBe(0)
    await filesToggle.click()
    await expect(files).toBeHidden()
    const edges = () => chat.evaluate((el) => {
      const panel = el.getBoundingClientRect()
      const main = el.closest("main")!.getBoundingClientRect()
      return { left: Math.round(panel.left - main.left), right: Math.round(main.right - panel.right) }
    })
    await expect.poll(edges).toEqual({ left: 8, right: 8 })
    await page.screenshot({ path: `/tmp/areza-${side}-files-closed.png` })
    await projectsToggle.click()
    await expect(page.locator('[data-component="project-sidebar-slot"]')).toHaveCSS("width", "0px")
    await expect.poll(edges).toEqual({ left: 8, right: 8 })
    await page.screenshot({ path: `/tmp/areza-${side}-both-closed.png` })
    await filesToggle.click()
    await expect(files).toBeVisible()
    await projectsToggle.click()
    await expect(sidebar).toBeVisible()
  }
  await checkClosedPanel("right")
  await sidebar.getByRole("button", { name: "Settings", exact: true }).click()
  await position.click()
  await page.locator('[data-component="menu-v2-item"]').filter({ hasText: "Left" }).click({ timeout: 5000 })
  await page.keyboard.press("Escape")
  await expect.poll(async () => (await sidebar.boundingBox())!.x < (await chat.boundingBox())!.x).toBe(true)
  await expect.poll(async () => (await files.boundingBox())!.x > (await chat.boundingBox())!.x).toBe(true)
  await expect.poll(async () => (await filesToggle.boundingBox())!.x > (await projectsToggle.boundingBox())!.x).toBe(true)
  await collapseChat("left")
  await checkClosedPanel("left")
  await page.emulateMedia({ reducedMotion: "reduce" })
  await filesToggle.click()
  await expect(files).toBeHidden()
  expect(await files.evaluate((element) => element.getAnimations().length)).toBe(0)
  await filesToggle.click()
  await expect(files).toBeVisible()
  expect(await files.evaluate((element) => element.getAnimations().length)).toBe(0)
  const reducedHandle = (await divider.boundingBox())!
  const reducedWidth = (await chat.boundingBox())!.width
  await page.mouse.move(reducedHandle.x + reducedHandle.width / 2, reducedHandle.y + 80)
  await page.mouse.down()
  await page.mouse.move(reducedHandle.x + reducedHandle.width / 2 - (reducedWidth - 220), reducedHandle.y + 80)
  await page.mouse.up()
  await expect(chat).toHaveCSS("width", "0px")
  expect(await chat.evaluate((element) => element.getAnimations().length)).toBe(0)
  expect(await chat.locator('[data-slot="session-chat-content"]').evaluate((element) => element.getAnimations().length)).toBe(0)
})

test("shows live work, jumps to the latest reply, and previews every changed file", async ({ page }) => {
  const fixture = await setupTimelineBenchmark(page, {
    historyTurns: 12,
    eventBatch: 1,
    newLayoutDesigns: true,
    vcsDiff: Array.from({ length: 30 }, (_, index) => ({
      file: `src/file-${index}.ts`, status: "modified", additions: 2, deletions: 1,
    })),
  })
  const latest = page.locator('[data-slot="chat-latest"]')
  const changes = page.locator('[data-slot="chat-changes"]')
  await expect(changes).toContainText("30 Changed files")
  await expect(changes).toContainText("+60")
  await expect(changes).toContainText("-30")
  fixture.transport.enqueue({
    directory: "C:/OpenCode/TimelineStateRegression",
    payload: { type: "session.status", properties: { sessionID: "ses_timeline_state_regression", status: { type: "busy" } } },
  })
  await fixture.scrollToBottom()
  await expect(latest).toBeHidden()
  fixture.transport.enqueue(buildInitialStreamEvent(30))
  await expect(fixture.text).toBeVisible()
  fixture.transport.enqueue(buildStreamDeltaEvents(30))
  await expect(fixture.text).toContainText("benchmark-complete")
  await expect.poll(() => fixture.scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(3)
  await expect(latest).toBeHidden()
  const spacer = page.locator('[data-timeline-row="bottom-spacer"]')
  expect((await spacer.boundingBox())!.height).toBe(128)
  const dock = (await page.locator('[data-component="session-prompt-dock"]').boundingBox())!
  const pill = (await changes.boundingBox())!
  expect(dock.y - pill.y - pill.height).toBeLessThanOrEqual(10)
  expect(dock.y - pill.y - pill.height).toBeGreaterThanOrEqual(0)
  const finalRow = await page.locator('[data-timeline-row]').filter({ has: fixture.text }).boundingBox()
  expect(finalRow!.y + finalRow!.height).toBeLessThan(pill.y)
  await page.screenshot({ path: "/tmp/areza-chat-bottom-spacing.png" })
  await fixture.scroller.hover()
  await page.mouse.wheel(0, -600)
  fixture.transport.enqueue({
    directory: "C:/OpenCode/TimelineStateRegression",
    payload: { type: "session.status", properties: { sessionID: "ses_timeline_state_regression", status: { type: "busy" } } },
  })
  await expect(latest).toHaveAttribute("data-working", "true")
  await expect(latest.locator('[data-component="spinner"]')).toBeVisible()
  const top = await fixture.scroller.evaluate((el) => el.scrollTop)
  fixture.transport.enqueue(buildStreamDeltaEvents(3))
  await expect.poll(() => fixture.transport.pendingCount()).toBe(0)
  expect(Math.abs(await fixture.scroller.evaluate((el) => el.scrollTop) - top)).toBeLessThan(3)
  await latest.click()
  await expect.poll(() => fixture.scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(3)
  await expect(latest).toBeHidden()
  await changes.hover()
  const preview = page.locator('[data-component="chat-changes-preview"]')
  await expect(preview).toBeVisible()
  await expect(preview.getByRole("button")).toHaveCount(30)
  const viewport = preview.locator(".scroll-view__viewport")
  await expect(viewport).toHaveCSS("padding-inline-end", "12px")
  expect(await viewport.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await expect(viewport).toHaveCSS("scrollbar-width", "none")
  await expect(preview.locator(".scroll-view__thumb[data-orientation=vertical]")).toBeVisible()
  await preview.hover()
  await page.mouse.wheel(0, 2000)
  await expect(preview.getByRole("button", { name: "src/file-29.ts +2 -1", exact: true })).toBeInViewport()
  await page.screenshot({ path: "/tmp/areza-chat-activity.png" })
  await preview.getByRole("button").last().click()
  await expect(page.locator('[data-component="session-right-panel"]')).toHaveAttribute("data-opened", "true")
  fixture.transport.enqueue({
    directory: "C:/OpenCode/TimelineStateRegression",
    payload: { type: "session.status", properties: { sessionID: "ses_timeline_state_regression", status: { type: "idle" } } },
  })
  await fixture.scroller.hover()
  await page.mouse.wheel(0, -600)
  await expect(latest).toBeVisible()
  await expect(latest).not.toHaveAttribute("data-working")
  await expect(latest.locator('[data-component="spinner"]')).toHaveCount(0)
  await page.screenshot({ path: "/tmp/areza-chat-idle.png" })
})

test("centers short checkpoint rails and renders the Zen icon with animated model groups", async ({ page }) => {
  await setupTimelineBenchmark(page, { historyTurns: 3, eventBatch: 1, newLayoutDesigns: true })
  const rail = page.locator('[data-component="message-navigator"]')
  const marks = rail.locator('[data-slot="navigator-marks"]')
  const bounds = (await rail.boundingBox())!
  const list = (await marks.boundingBox())!
  expect(list.y + list.height / 2).toBeCloseTo(bounds.y + bounds.height / 2, 0)
  await page.screenshot({ path: "/tmp/areza-centered-checkpoints.png" })
  const sidebar = page.locator('[data-component="project-sidebar"]')
  await page.route("**/pty/shells*", (route) => route.fulfill({ json: [] }))
  if (!(await sidebar.isVisible())) await page.getByRole("button", { name: "Toggle sidebar", exact: true }).click()
  await sidebar.getByRole("button", { name: "Settings", exact: true }).click()
  await page.getByRole("tab", { name: "Models", exact: true }).click()
  const group = page.locator('[data-component="settings-models-provider"]').first()
  const icon = group.locator('[data-component="provider-icon"] path')
  await expect(icon).toBeVisible()
  expect(await icon.evaluate((el) => (el as SVGGraphicsElement).getBBox().width)).toBeGreaterThan(10)
  const trigger = group.locator("h3 button")
  const content = group.locator('[data-slot="provider-models-content"]')
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect(content).toHaveCSS("height", "0px")
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await expect(group.getByRole("switch")).toBeVisible()
  await expect(content).toHaveCSS("opacity", "1")
  await expect.poll(() => content.evaluate((el) => el.clientHeight)).toBeGreaterThan(40)
  await page.screenshot({ path: "/tmp/areza-zen-accordion.png" })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await expect(content).toHaveCSS("transition-duration", "0s")
})
