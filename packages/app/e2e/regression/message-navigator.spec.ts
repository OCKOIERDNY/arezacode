import { expect, test } from "@playwright/test"
import { setupTimelineBenchmark } from "../performance/timeline/session-timeline-benchmark.fixture"

test.use({ colorScheme: "dark" })

test("previews turns and jumps through virtualized history with pointer and keyboard", async ({ page }) => {
  const fixture = await setupTimelineBenchmark(page, { historyTurns: 60, eventBatch: 1, newLayoutDesigns: true })
  const rail = page.getByRole("navigation", { name: "Conversation navigation" })
  const marks = rail.getByRole("button")
  await expect(marks).toHaveCount(61)
  const target = marks.nth(6)
  await target.hover()
  const preview = rail.getByRole("tooltip")
  await expect(preview).toContainText("Historical prompt 6")
  await expect(preview).toHaveCSS("opacity", "1")
  await expect(preview.locator('[data-slot="navigator-reply"]')).not.toBeEmpty()
  await page.screenshot({ path: "/tmp/areza-message-navigator-preview.png" })
  const positions = await target.evaluate((button) => {
    const root = document.querySelector<HTMLElement>(".message-timeline-scroll .scroll-view__viewport")!
    const samples = [root.scrollTop]
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }))
    return new Promise<number[]>((resolve) => {
      const deadline = performance.now() + 2500
      const sample = () => {
        samples.push(root.scrollTop)
        if (performance.now() >= deadline) return resolve(samples)
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
  })
  const distance = positions[0]! - positions.at(-1)!
  expect(distance).toBeGreaterThan(1000)
  expect(new Set(positions.filter((top) => top < positions[0]! && top > positions.at(-1)!)).size).toBeGreaterThan(3)
  expect(Math.max(...positions.slice(1).map((top, index) => Math.abs(top - positions[index]!)))).toBeLessThan(distance / 2)
  await expect(page).toHaveURL(/#message-msg_0000_0006_a_user$/)
  await expect(fixture.scroller.getByText("Historical prompt 6", { exact: true })).toBeInViewport()
  await page.mouse.move(900, 100)
  await expect(preview).toBeHidden()
  await page.screenshot({ path: "/tmp/areza-message-navigator-arrived.png" })
  await target.focus()
  await target.press("ArrowDown")
  await expect(marks.nth(7)).toBeFocused()
  await marks.nth(7).press("Enter")
  await expect(page).toHaveURL(/#message-msg_0000_0007_a_user$/)
  await expect(fixture.scroller.getByText("Historical prompt 7", { exact: true })).toBeInViewport()
  await marks.nth(7).press("Escape")
  await expect(preview).toBeHidden()
  await page.locator('[data-slot="chat-latest"]').click()
  await expect(marks.last()).toHaveAttribute("aria-current", "step")
  await page.goto(`${page.url().split("#")[0]}#message-msg_0000_0006_a_user`)
  await page.reload()
  await expect(fixture.scroller.getByText("Historical prompt 6", { exact: true })).toBeInViewport()
})

test("respects reduced motion and keeps narrow chats unobstructed", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await setupTimelineBenchmark(page, { historyTurns: 5, eventBatch: 1, newLayoutDesigns: true })
  const rail = page.getByRole("navigation", { name: "Conversation navigation" })
  await rail.getByRole("button").first().hover()
  await expect(rail.getByRole("tooltip")).toHaveCSS("transition-duration", "0s")
  await rail.getByRole("button").first().click()
  await expect(page).toHaveURL(/#message-msg_0000_0000_a_user$/)
  await page.setViewportSize({ width: 600, height: 800 })
  await expect(rail).toBeHidden()
})
