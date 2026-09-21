import { expect, test } from "@playwright/test"
import { buildInitialStreamEvent, buildStreamDeltaEvents, setupTimelineBenchmark } from "../performance/timeline/session-timeline-benchmark.fixture"

for (const target of ["model", "approval", "settings"] as const) {
  test(`${target} stays open during chat updates`, async ({ page }) => {
    const fixture = await setupTimelineBenchmark(page, { historyTurns: 2, eventBatch: 20, newLayoutDesigns: true })
    await page.route("**/pty/shells*", (route) => route.fulfill({ json: [], headers: { "access-control-allow-origin": "*" } }))
    if (target === "settings") {
      await page.locator('[data-component="project-sidebar"]').getByRole("button", { name: "Settings", exact: true }).click()
    } else {
      const trigger = page.locator(`[data-action="prompt-${target}"]`)
      if (target === "approval") await trigger.getByRole("button").click()
      else await trigger.click()
    }
    const content = target === "settings"
      ? page.getByRole("tab", { name: "General", exact: true })
      : target === "approval"
        ? page.getByRole("option", { name: /^Full access/ })
        : page.getByPlaceholder("Search models")
    await expect(content).toBeVisible()
    await content.evaluate((element) => element.setAttribute("data-stability-marker", "original"))
    fixture.transport.enqueue([
      { directory: "C:/OpenCode/TimelineStateRegression", payload: { type: "session.status", properties: { sessionID: "ses_timeline_state_regression", status: { type: "busy" } } } },
      buildInitialStreamEvent(2),
      ...buildStreamDeltaEvents(2),
    ])
    await expect(fixture.text).toContainText("benchmark-complete")
    await expect(content).toBeVisible()
    await expect(content).toHaveAttribute("data-stability-marker", "original")
    fixture.transport.enqueue({ directory: "C:/OpenCode/TimelineStateRegression", payload: { type: "session.status", properties: { sessionID: "ses_timeline_state_regression", status: { type: "idle" } } } })
    await expect(page.locator('[data-action="prompt-submit"]')).not.toHaveAttribute("aria-label", /stop/i)
    await expect(content).toBeVisible()
    await expect(content).toHaveAttribute("data-stability-marker", "original")
    await page.screenshot({ path: `/tmp/areza-${target}-chat-update.png` })
  })
}
