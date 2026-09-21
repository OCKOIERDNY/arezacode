import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  completedAssistantInfo,
  messageUpdated,
  partUpdated,
  reasoningPart,
  setupTimeline,
  shell,
  status,
  textPart,
  userMessage,
  userText,
} from "../performance/timeline-stability/fixture"

for (const expanded of [false, true]) {
  test(`preserves shell user intent from a ${expanded ? "expanded" : "collapsed"} default`, async ({ page }) => {
    const id = `prt_shell_default_${expanded}`
    const timeline = await setupTimeline(page, {
      messages: [userMessage(), assistantMessage([shell(id, "completed", lines(3))])],
      settings: { shellToolPartsExpanded: expanded },
    })
    await page.locator('[data-component="context-tool-group-trigger"]').click()
    const trigger = page.locator(`[data-timeline-part-id="${id}"] [data-slot="collapsible-trigger"]`)
    await expect(trigger).toHaveAttribute("aria-expanded", String(expanded))
    await trigger.click()
    await expect(trigger).toHaveAttribute("aria-expanded", String(!expanded))

    await timeline.send(partUpdated(shell(id, "completed", lines(6))), 180)
    await timeline.send(partUpdated(textPart(`prt_sibling_${expanded}`, "Sibling content")), 180)
    await timeline.send(status("busy"), 100)
    await timeline.send(status("idle"), 250)
    await page.locator('.completed-work > [data-slot="collapsible-trigger"]').click()
    await expect(trigger).toHaveAttribute("aria-expanded", String(!expanded))
  })
}

test("shows and expands a running shell command without shimmering it", async ({ page }) => {
  const id = "prt_shell_running_command"
  const command = "sleep 10 && echo done"
  await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([shell(id, "running", "still running", command)], { completed: false })],
    settings: { shellToolPartsExpanded: false },
  })
  await page.locator('[data-component="context-tool-group-trigger"]').click()

  const tool = page.locator(`[data-timeline-part-id="${id}"]`)
  await expect(tool.locator('[data-component="text-shimmer"]')).toHaveAttribute("data-active", "true")
  await expect(tool.locator('[data-component="shell-submessage"]')).toHaveText(command)
  await expect(tool.locator('[data-component="shell-submessage"] [data-component="text-shimmer"]')).toHaveCount(0)
  await tool.locator('[data-slot="collapsible-trigger"]').click()
  await expect(tool.locator('[data-slot="collapsible-trigger"]')).toHaveAttribute("aria-expanded", "true")
  await expect(tool.locator('[data-slot="bash-pre"]')).toContainText("still running")
})

test("transitions thinking and hidden reasoning through busy to idle", async ({ page }) => {
  const reasoningID = "prt_reasoning_hidden"
  const assistant = assistantMessage([reasoningPart(reasoningID, "## Inspecting stability")], { completed: false })
  const timeline = await setupTimeline(page, {
    messages: [userMessage(), assistant],
    settings: { showReasoningSummaries: false },
    cpuRate: 4,
  })
  await timeline.send(status("busy"), 150)

  await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()
  await expect(page.getByText("Inspecting stability", { exact: true })).toBeVisible()
  await expect(page.locator(`[data-timeline-part-id="${reasoningID}"]`)).toHaveCount(0)
  await timeline.send(partUpdated(shell("prt_reasoning_shell", "running")), 160)
  await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()
  await timeline.send(partUpdated(shell("prt_reasoning_shell", "completed", "done")), 180)
  await timeline.send(messageUpdated(completedAssistantInfo(assistant.info)), 100)
  await timeline.send(status("idle"), 300)
  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(page.locator(`[data-timeline-part-id="${reasoningID}"]`)).toHaveCount(0)
})

test("moves busy through retry and recovery to final idle content", async ({ page }) => {
  const assistant = assistantMessage([], { completed: false })
  const timeline = await setupTimeline(page, {
    messages: [
      userMessage(undefined, {
        summary: {
          diffs: [
            {
              file: "src/retry.ts",
              additions: 1,
              deletions: 1,
              patch: "@@ -1 +1 @@\n-export const retry = false\n+export const retry = true",
            },
          ],
        },
      }),
      assistant,
    ],
  })
  await timeline.send(status("busy"), 140)
  await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()
  await expect(page.locator('[data-timeline-row="DiffSummary"]')).toHaveCount(0)
  await timeline.send(status("retry"), 180)
  await expect(page.locator('[data-timeline-row="Retry"]')).toBeVisible()
  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await timeline.send(status("busy", 2), 180)
  await expect(page.locator('[data-timeline-row="Thinking"]')).toBeVisible()
  await timeline.send(partUpdated(textPart("prt_recovered", "Recovered response")), 140)
  await timeline.send(messageUpdated(completedAssistantInfo(assistant.info)), 100)
  await timeline.send(status("idle"), 350)
  await expect(page.locator('[data-timeline-row="Retry"]')).toHaveCount(0)
  await expect(page.locator('[data-timeline-row="Thinking"]')).toHaveCount(0)
  await expect(page.locator('[data-timeline-row="DiffSummary"]')).toBeVisible()
})

test("completed turns fold work and show a compact edited files card", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" })
  const assistant = assistantMessage([
    textPart("prt_001_progress", "I am checking the shared components."),
    ...Array.from({ length: 8 }, (_, index) => shell(`prt_010_shell_${index}`, "completed", "Check passed")),
    textPart("prt_999_final", "Updated the chat controls and verified the completed-turn layout."),
  ], { completed: false })
  const timeline = await setupTimeline(page, {
    messages: [userMessage(undefined, { summary: { diffs: Array.from({ length: 6 }, (_, index) => ({
      file: `src/component-${index}.ts`, additions: 12, deletions: 3,
      patch: "@@ -1 +1 @@\n-export const enabled = false\n+export const enabled = true",
    })) } }), assistant],
    settings: { newLayoutDesigns: true, shellToolPartsExpanded: false },
  })
  await timeline.send(status("busy"), 100)
  await expect(page.locator(".completed-work")).toHaveCount(0)
  await timeline.send(messageUpdated(completedAssistantInfo(assistant.info)), 100)
  await timeline.send(status("idle"), 250)
  const work = page.locator(".completed-work")
  const trigger = work.locator(':scope > [data-slot="collapsible-trigger"]')
  await expect(trigger).toHaveText("Worked for 3s")
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect(page.getByText("Updated the chat controls and verified the completed-turn layout.", { exact: true })).toBeVisible()
  const card = page.locator("[data-completed-card]")
  await expect(card).toContainText("Edited 6 files")
  await expect(card.locator('[data-slot="session-turn-diff-filename"]')).toHaveCount(3)
  await expect(card.getByRole("button", { name: "Review", exact: true })).toBeVisible()
  for (const trigger of await card.locator('[data-slot="accordion-trigger"]').all()) {
    await expect(trigger).toHaveCSS("border-top-width", "0px")
    await expect(trigger).toHaveCSS("border-radius", "0px")
  }
  await page.screenshot({ path: "/tmp/areza-completed-turn.png" })
  await card.getByRole("button", { name: "Review", exact: true }).click()
  await expect(card.locator('[data-slot="session-turn-diff-view"]')).toBeVisible()
  await expect(card.locator('[data-slot="accordion-content"]').first()).toHaveCSS("border-radius", "0px")
  await card.locator('[data-slot="accordion-trigger"]').first().click()
  await card.getByRole("button", { name: "Show 3 more files" }).click()
  await expect(card.locator('[data-slot="session-turn-diff-filename"]')).toHaveCount(6)
  await card.getByRole("button", { name: "Show less" }).click()
  await trigger.click()
  await expect(work.getByText("I am checking the shared components.", { exact: true })).toBeVisible()
  await work.locator('[data-component="context-tool-group-trigger"]').click()
  await expect(work.locator('[data-component="tool-trigger"]')).toHaveCount(8)
  expect((await work.locator(".completed-work-scroll").boundingBox())!.height).toBeLessThanOrEqual(320)
  await trigger.scrollIntoViewIfNeeded()
  await page.screenshot({ path: "/tmp/areza-completed-work-expanded.png" })
})

test("sent messages scroll attachments and long text, highlight skills and expand", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" })
  const image = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#4d8cef"/></svg>').toString("base64")
  await setupTimeline(page, {
    messages: [userMessage([
      userText("Polish this with [$emil-design-eng](/skills/emil-design-eng/SKILL.md).\n\n" + Array.from({ length: 25 }, (_, index) => `Requirement ${index + 1}: keep all of this message accessible.`).join("\n\n")),
      ...Array.from({ length: 12 }, (_, index) => ({ id: `prt_attachment_${index}`, type: "file" as const, mime: "image/svg+xml", filename: `Design ${index + 1}`, url: image })),
    ])],
    settings: { newLayoutDesigns: true },
  })
  const message = page.locator('[data-component="user-message"]')
  const attachments = message.locator(".user-message-attachment-scroll > .scroll-view__viewport")
  const viewport = message.locator(".user-message-text-scroll > .scroll-view__viewport")
  const bubble = message.locator('[data-slot="user-message-text"]')
  const skill = message.locator('[data-highlight="skill"]')
  await expect(skill).toHaveText("emil-design-eng")
  await expect(skill.locator("svg")).toBeVisible()
  expect(await skill.evaluate((el) => getComputedStyle(el).color)).not.toBe(await bubble.evaluate((el) => getComputedStyle(el).color))
  expect((await attachments.boundingBox())!.y).toBeLessThan((await bubble.boundingBox())!.y)
  expect(await attachments.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await attachments.hover()
  await page.mouse.wheel(400, 0)
  await expect.poll(() => attachments.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  expect((await viewport.boundingBox())!.height).toBeLessThanOrEqual(320)
  await expect(bubble).toHaveAttribute("data-fade-bottom", "true")
  await expect(bubble).toHaveAttribute("data-fade-top", "false")
  await page.screenshot({ path: "/tmp/areza-sent-message-collapsed.png" })
  await viewport.evaluate((el) => { el.scrollTop = el.scrollHeight })
  await expect(bubble).toHaveAttribute("data-fade-bottom", "false")
  await expect(bubble).toHaveAttribute("data-fade-top", "true")
  await message.getByRole("button", { name: "Expand message", exact: true }).click()
  await expect(bubble).toHaveAttribute("data-expanded", "true")
  await expect(bubble).toHaveAttribute("data-fade-top", "false")
  expect(await viewport.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1)
  await message.getByRole("button", { name: "Collapse message", exact: true }).click()
  await expect(bubble).toHaveAttribute("data-expanded", "false")
  await page.setViewportSize({ width: 800, height: 700 })
  await expect(message.getByRole("button", { name: "Expand message", exact: true })).toBeVisible()
  await viewport.evaluate((el) => { el.scrollTop = 0 })
  await message.locator(".user-message-attachment-scroll").scrollIntoViewIfNeeded()
  await page.screenshot({ path: "/tmp/areza-sent-message-narrow.png" })
  const thumbnail = message.getByRole("button", { name: "Design 8", exact: true })
  await thumbnail.scrollIntoViewIfNeeded()
  await thumbnail.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog")).toBeVisible()
})

test("short sent messages stay compact without expand controls", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" })
  await setupTimeline(page, {
    messages: [userMessage([userText("Please review this.")])],
    settings: { newLayoutDesigns: true },
  })
  const bubble = page.locator('[data-slot="user-message-text"]')
  await expect(bubble).toBeVisible()
  await expect(page.getByRole("button", { name: "Expand message", exact: true })).toHaveCount(0)
  expect((await bubble.boundingBox())!.height).toBeLessThan(60)
  await expect(bubble).toHaveAttribute("data-fade-bottom", "false")
})

function lines(count: number) {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n")
}
