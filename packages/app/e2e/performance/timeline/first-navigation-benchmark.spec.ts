import { expectSessionTitle } from "../../utils/waits"
import { benchmark, expect } from "../benchmark"
import { measureFirstNavigation } from "./first-navigation-probe"
import { fixture } from "./session-timeline-stress.fixture"
import {
  installStressSessionTabs,
  installTimelineSettings,
  mockStressTimeline,
  stressSessionHref,
} from "./timeline-test-helpers"
import { waitForStableTimeline } from "./session-tab-switch-probe"

const contentSelector = '[data-message-id], [data-component="prompt-input"]'
const draftID = "draft_first_navigation"

benchmark.describe("performance: first navigation paint", () => {
  benchmark("measures first sidebar session navigation", async ({ page, report }) => {
    await setup(page)
    const href = stressSessionHref(fixture.targetID)
    const result = await measureFirstNavigation(page, {
      href,
      triggerSelector: '[data-component="project-sidebar"] [data-component="home-session-row"]',
      destinationPath: href,
      sourceSelector: messageSelector(fixture.expected.sourceMessageIDs.at(-1)!),
      destinationSelector: messageSelector(fixture.expected.targetMessageIDs.at(-1)!),
      contentSelector,
      navigate: async () => {
        await page.locator('[data-component="project-sidebar"] [data-component="home-session-row"]').filter({ hasText: fixture.expected.targetTitle }).first().click()
        await expectSessionTitle(page, fixture.expected.targetTitle)
      },
    })
    report(result)
    expect(result.summary.destinationSamples).toBeGreaterThanOrEqual(3)
    expect(result.summary.stableDestinationObservedMs).not.toBeNull()
  })

  benchmark("opens the new session page before its lazy module is used", async ({ page, report }) => {
    await setup(page, draftID)
    const href = "/new-session"
    const result = await measureFirstNavigation(page, {
      href,
      triggerSelector: '[data-action="home-project-new-session"]',
      destinationPath: href,
      sourceSelector: messageSelector(fixture.expected.sourceMessageIDs.at(-1)!),
      destinationSelector: '[data-component="prompt-input"]',
      contentSelector,
      navigate: async () => {
        await page.locator('[data-action="home-project-new-session"]').first().click()
        await expect(page.locator('[data-component="prompt-input"]')).toBeVisible()
      },
    })
    report(result)
    expect(result.summary.destinationSamples).toBeGreaterThanOrEqual(3)
    expect(result.summary.stableDestinationObservedMs).not.toBeNull()
  })

  benchmark("measures first child session navigation", async ({ page, report }) => {
    await setup(page)
    await page.getByText("Used tools", { exact: true }).last().click()
    const href = stressSessionHref(fixture.childID)
    await page.locator(`a[href="${href}"]`, { has: page.locator('[data-component="task-tool-card"]') }).click()
    await expect(page.getByRole("tabpanel", { name: "Agents" })).toBeVisible()
    const result = await measureFirstNavigation(page, {
      href,
      triggerSelector: '[role="tabpanel"] button',
      destinationPath: href,
      sourceSelector: messageSelector(fixture.expected.sourceMessageIDs.at(-1)!),
      destinationSelector: messageSelector(fixture.expected.childMessageIDs.at(-1)!),
      contentSelector,
      navigate: async () => {
        await page.getByRole("button", { name: "Open conversation", exact: true }).click()
        await expectSessionTitle(page, fixture.expected.childTitle)
      },
    })
    report(result)
    expect(result.summary.destinationSamples).toBeGreaterThanOrEqual(3)
    expect(result.summary.stableDestinationObservedMs).not.toBeNull()
  })
})

async function setup(page: Parameters<typeof mockStressTimeline>[0], draft?: string) {
  await mockStressTimeline(page)
  await installTimelineSettings(page)
  await installStressSessionTabs(page, draft ? { draftID: draft } : undefined)
  await page.goto(stressSessionHref(fixture.sourceID))
  await expectSessionTitle(page, fixture.expected.sourceTitle)
  await waitForStableTimeline(page, fixture.expected.sourceMessageIDs.at(-1)!)
}

function messageSelector(id: string) {
  return `[data-message-id="${id}"]`
}
