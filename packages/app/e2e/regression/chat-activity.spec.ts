import { expect, test } from "@playwright/test"
import { buildInitialStreamEvent, buildStreamDeltaEvents, setupTimelineBenchmark } from "../performance/timeline/session-timeline-benchmark.fixture"

test.use({ colorScheme: "dark" })

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
  const fixture = await setupTimelineBenchmark(page, { historyTurns: 12, eventBatch: 1, newLayoutDesigns: true })
  const latest = page.locator('[data-slot="chat-latest"]')
  await fixture.scrollToBottom()
  await fixture.scroller.hover()
  await page.mouse.wheel(0, -1600)
  await expect(latest).toBeVisible()
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
  await expect(latest).toHaveCount(0)
  await page.screenshot({ path: "/tmp/areza-smooth-scroll-after.png" })
  fixture.transport.enqueue(buildInitialStreamEvent(30))
  fixture.transport.enqueue(buildStreamDeltaEvents(30))
  await expect(fixture.text).toContainText("benchmark-complete")
  await expect.poll(() => fixture.scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(3)
  await page.emulateMedia({ reducedMotion: "reduce" })
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
    await expect(chat).toHaveCSS("width", "0px")
    await page.mouse.up()
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
  await expect(latest).toHaveCount(0)
  fixture.transport.enqueue(buildInitialStreamEvent(30))
  await expect(fixture.text).toBeVisible()
  fixture.transport.enqueue(buildStreamDeltaEvents(30))
  await expect(fixture.text).toContainText("benchmark-complete")
  await expect.poll(() => fixture.scroller.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(3)
  await expect(latest).toHaveCount(0)
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
  await expect(latest).toHaveCount(0)
  await changes.hover()
  const preview = page.locator('[data-component="chat-changes-preview"]')
  await expect(preview).toBeVisible()
  await expect(preview.getByRole("button")).toHaveCount(30)
  const viewport = preview.locator(".scroll-view__viewport")
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
