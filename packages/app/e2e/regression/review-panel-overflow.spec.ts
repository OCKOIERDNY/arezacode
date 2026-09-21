import { expect, test } from "@playwright/test"
import { setupTimelineBenchmark } from "../performance/timeline/session-timeline-benchmark.fixture"

test.use({
  launchOptions: async ({ launchOptions }, use) => {
    await use({ ...launchOptions, ignoreDefaultArgs: ["--hide-scrollbars"] })
  },
})

test("scrolls a narrow file panel horizontally without expanding the sidebar", async ({ page }) => {
  await setupTimelineBenchmark(page, {
    historyTurns: 3,
    eventBatch: 1,
    newLayoutDesigns: true,
    vcsDiff: [{ file: "src/example.ts", status: "modified", additions: 2, deletions: 1 }],
  })
  await page.setViewportSize({ width: 1800, height: 800 })
  const projects = page.locator('[data-component="project-sidebar-slot"]')
  if (await projects.getAttribute("data-collapsing") === "false") {
    await page.locator('[aria-controls="project-sidebar"]').click()
    await expect(projects).toHaveCSS("width", "0px")
  }
  await page.locator('[aria-controls="review-panel"]').click()
  const panel = page.locator('[data-component="session-right-panel"]')
  const body = panel.locator('[data-slot="session-review-v2-body"]')
  const viewport = body.locator(":scope > .scroll-view__viewport")
  const tree = body.locator('[data-slot="session-review-v2-sidebar"]')
  await expect(tree).toBeVisible()
  await expect
    .poll(() => page.locator('[data-component="session-chat-panel"]').evaluate((el) => el.getAnimations().length))
    .toBe(0)
  await expect.poll(() => panel.evaluate((el) => el.getAnimations().length)).toBe(0)
  const divider = body.locator('[data-slot="session-review-v2-sidebar-resize"] [data-component="resize-handle"]')
  const handle = (await divider.boundingBox())!
  await page.mouse.move(handle.x + 1, handle.y + 100)
  await page.mouse.down()
  await page.mouse.move(handle.x + 241, handle.y + 100, { steps: 8 })
  await page.mouse.up()
  await expect(tree).toHaveCSS("width", "480px")
  await page.setViewportSize({ width: 1000, height: 800 })
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeLessThan(480)
  await body.hover()
  await page.mouse.wheel(700, 0)
  await expect.poll(() => viewport.evaluate((el) => el.scrollLeft)).toBeGreaterThan(300)
  await expect(panel.getByRole("button", { name: "Split diff", exact: true })).toBeInViewport()
  await page.screenshot({ path: "/tmp/areza-review-horizontal-preview.png" })
  await page.mouse.wheel(-700, 0)
  await expect.poll(() => viewport.evaluate((el) => el.scrollLeft)).toBe(0)
  const bounds = (await body.locator(':scope > .scroll-view__thumb[data-orientation=horizontal]').boundingBox())!
  await page.mouse.move(bounds.x + 30, bounds.y + bounds.height - 5)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 280, bounds.y + bounds.height - 5, { steps: 10 })
  await page.mouse.up()
  await expect.poll(() => viewport.evaluate((el) => el.scrollLeft)).toBeGreaterThan(200)
  await expect(tree).toHaveCSS("width", "480px")
})
