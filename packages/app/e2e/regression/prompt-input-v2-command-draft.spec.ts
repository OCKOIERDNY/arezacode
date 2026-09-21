import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { currentSession, mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/PromptInputV2Editing"
const projectID = "proj_prompt_input_v2_editing"
const sessionID = "ses_prompt_input_v2_editing"

test.use({ colorScheme: "dark" })

test.beforeEach(async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "prompt-input-v2-editing",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: "prompt-input-v2-editing",
        projectID,
        directory,
        title: "Prompt input V2 editing",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
})

test("preserves the draft when a populated command menu triggers a built-in", async ({ page }) => {
  const composer = page.locator('[data-component="prompt-input-v2"]')
  const input = composer.locator('[data-component="prompt-input"]')
  await expectAppVisible(composer)

  await input.fill("keep me")
  await composer.getByRole("button", { name: "Add images and files" }).click()
  await page.getByRole("menuitem", { name: "Commands" }).click()
  await page.locator('[data-suggestion-id="model.choose"]').click()

  await expect(input).toHaveText("keep me")
})

test("accepts document attachments for automatic backend conversion", async ({ page }) => {
  const composer = page.locator('[data-component="prompt-input-v2"]')
  await expectAppVisible(composer)
  const picker = page.locator('input[type="file"]')
  await expect(picker).toHaveAttribute("accept", /\.docx/)
  await picker.setInputFiles({
    name: "Automatic conversion.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("PK\x03\x04"),
  })
  await expect(composer.getByText("Automatic conversion.docx", { exact: true })).toBeVisible()
  await page.screenshot({ path: "/tmp/areza-automatic-document-attachment.png", fullPage: true })
})

test("keeps compact visible in empty chats without consuming the draft", async ({ page }) => {
  const composer = page.locator('[data-component="prompt-input-v2"]')
  const input = composer.locator('[data-component="prompt-input"]')
  await expectAppVisible(composer)
  await input.fill("/compact")
  const compact = page.locator('[data-suggestion-id="session.compact"]')
  await expect(compact).toBeVisible()
  await expect(compact).toBeDisabled()
  await input.press("Enter")
  await expect(input).toHaveText("/compact")
  await compact.hover()
  await expect(page.getByRole("tooltip")).toContainText("Send a message in this chat before compacting it.")
  await expect(page.getByRole("tooltip")).toHaveCSS("opacity", "1")
  await page.screenshot({ path: "/tmp/areza-compact-visible.png" })
})

test("enables compact for an existing conversation", async ({ page }) => {
  await page.route(
    (url) => url.pathname === `/session/${sessionID}/message`,
    (route) =>
      route.fulfill({
        json: [
          {
            info: {
              id: "msg_compact",
              sessionID,
              role: "user",
              agent: "build",
              model: { providerID: "test", modelID: "test" },
              time: { created: 1700000000000 },
            },
            parts: [
              { id: "prt_compact", sessionID, messageID: "msg_compact", type: "text", text: "Review this project" },
            ],
          },
        ],
      }),
  )
  await page.reload()
  const composer = page.locator('[data-component="prompt-input-v2"]')
  await expectAppVisible(composer)
  await expect(page.getByText("Review this project", { exact: true })).toBeVisible()
  await composer.locator('[data-component="prompt-input"]').fill("/compact")
  await expect(page.locator('[data-suggestion-id="session.compact"]')).toBeEnabled()
})

test("groups slash commands and shows skill origins and instruction token estimates", async ({ page }) => {
  const skills = [
    { name: "system-review", description: "Review code safely", location: "<built-in>", content: "a".repeat(400) },
    {
      name: "personal-design-with-a-long-skill-name",
      description:
        "Polish the interface with careful attention to spacing, typography, animations, accessibility, and interaction details",
      location: "C:/OpenCode/.agents/skills/design/SKILL.md",
      content: "b".repeat(800),
    },
    {
      name: "project-check",
      description: "Check this project",
      location: `${directory}/.agents/skills/check/SKILL.md`,
      content: "c".repeat(1200),
    },
  ]
  await page.route(
    (url) => url.pathname === "/skill",
    (route) => route.fulfill({ json: skills }),
  )
  await page.route(
    (url) => url.pathname === "/command",
    (route) =>
      route.fulfill({
        json: [
          { name: "review", description: "Review changes", source: "command", template: "Review the changes" },
          { name: "remote-review", description: "Review with MCP", source: "mcp", template: "Review remotely" },
          ...skills.map((skill) => ({
            name: skill.name,
            description: skill.description,
            source: "skill",
            template: skill.content,
          })),
        ],
      }),
  )
  await page.reload()
  const composer = page.locator('[data-component="prompt-input-v2"]')
  const input = composer.locator('[data-component="prompt-input"]')
  await expectAppVisible(composer)
  await input.fill("/")
  await expect(page.locator("[data-suggestion-group]")).toHaveText([
    "Commands",
    "Custom commands",
    "MCP prompts",
    "Skills",
  ])
  const system = page.locator('[data-suggestion-id="custom.system-review"]')
  await expect(system).toContainText("System")
  await expect(page.locator('[data-suggestion-id="custom.personal-design-with-a-long-skill-name"]')).toContainText(
    "Personal",
  )
  await expect(page.locator('[data-suggestion-id="custom.project-check"]')).toContainText("Project")
  await expect(system.locator("svg")).toBeVisible()
  const personal = page.locator('[data-suggestion-id="custom.personal-design-with-a-long-skill-name"]')
  const name = personal.getByText("/personal-design-with-a-long-skill-name", { exact: true })
  await expect(name).toHaveCSS("flex-shrink", "0")
  await expect(name).not.toHaveCSS("text-overflow", "ellipsis")
  await expect(personal.getByText(skills[1].description)).toHaveCSS("text-overflow", "ellipsis")
  await system.hover()
  await expect(page.getByRole("tooltip")).toBeVisible()
  await expect(page.getByRole("tooltip")).toContainText("≈ 100 tokens for skill instructions")
  await expect(page.getByRole("tooltip")).toHaveCSS("opacity", "1")
  await page.screenshot({ path: "/tmp/areza-slash-skills.png" })
  await input.fill("/personal")
  await expect(page.locator("[data-suggestion-group]")).toHaveText(["Skills"])
  await input.press("Enter")
  await expect(input).toHaveText("/personal-design-with-a-long-skill-name ")
})

test("keeps long drafts editable with the shared scrollbar", async ({ page }) => {
  const composer = page.locator('[data-component="prompt-input-v2"]')
  const input = composer.locator('[data-component="prompt-input"]')
  await input.fill(Array.from({ length: 80 }, (_, index) => `Draft line ${index}`).join("\n"))
  await expect(input).toHaveCSS("scrollbar-width", "none")
  await expect(input).toHaveCSS("max-height", "180px")
  await input.hover()
  const thumb = composer.locator('.scroll-view__thumb[data-orientation="vertical"]')
  await expect(thumb).toBeVisible()
  const bounds = (await thumb.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y - 150, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => input.evaluate((element) => element.scrollTop)).toBe(0)
  await input.press("ControlOrMeta+End")
  await input.press("!")
  await expect(input).toContainText("Draft line 79!")
  await expect.poll(() => input.evaluate((element) => element.scrollTop)).toBeGreaterThan(300)
  await page.screenshot({ path: "/tmp/areza-prompt-shared-scrollbar.png" })
})


test("changes approval modes in chat and restores the saved mode", async ({ page }) => {
  const state = { mode: "default" }
  await page.route(`**/api/session/${sessionID}`, async (route) => {
    await route.fulfill({ json: { data: { ...currentSession({ id: sessionID, projectID, directory, title: "Prompt input V2 editing" }), approvalMode: state.mode } }, headers: { "access-control-allow-origin": "*" } })
  })
  await page.route(`**/api/session/${sessionID}/approval`, async (route) => {
    state.mode = route.request().postDataJSON().mode
    await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
  })
  await page.reload()
  const mode = page.locator('[data-action="prompt-approval"]')
  await expect(mode).toContainText("Project defaults")
  await mode.getByRole("button").click()
  await expect(page.getByRole("option", { name: /^Full access/ })).toBeVisible()
  await page.screenshot({ path: "/tmp/areza-approval-modes.png" })
  await page.getByRole("option", { name: /^Ask for approval/ }).click()
  await expect(mode).toContainText("Ask for approval")
  await page.reload()
  await expect(mode).toContainText("Ask for approval")
  await mode.getByRole("button").click()
  await page.getByRole("option", { name: /^Approve for me/ }).click()
  await expect(mode).toContainText("Approve for me")
  await mode.getByRole("button").click()
  await page.getByRole("option", { name: /^Full access/ }).click()
  await expect(mode).toContainText("Full access")
  await expect(mode.locator('use[href="#opencode-v2-icon-shield"]')).toBeAttached()
  await expect.poll(() => mode.locator('[data-slot="select-v2-value-text"]').evaluate((element) => getComputedStyle(element).color)).toBe("rgb(242, 207, 118)")
  await page.screenshot({ path: "/tmp/areza-full-access-yellow.png" })
})
