import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const draftID = "draft_new_session_panel_corner"
const directory = "C:/OpenCode/NewSessionPanelCorner"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.use({
  viewport: { width: 935, height: 522 },
  deviceScaleFactor: 1,
})

test.beforeEach(async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_new_session_panel_corner",
      worktree: directory,
      vcs: "git",
      name: "new-session-panel-corner with a long project title to reveal on hover",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: Array.from({ length: 70 }, (_, index) => ({
      id: `ses_sidebar_${index.toString().padStart(3, "0")}`,
      slug: `sidebar-${index}`,
      title:
        index === 64
          ? "Project chat 65 with a long conversation title to reveal on hover"
          : `Project chat ${index + 1}`,
      directory,
      projectID: "proj_new_session_panel_corner",
      version: "1",
      time: { created: 1700000000000 + index, updated: 1700000000000 + index },
    })),
    pageMessages: () => ({ items: [] }),
    sessionStatus: { ses_sidebar_066: { type: "busy" } },
    permissions: [
      {
        id: "per_sidebar",
        sessionID: "ses_sidebar_067",
        permission: "bash",
        patterns: ["*"],
        always: [],
        metadata: {},
      },
    ],
    events: () => [
      {
        directory,
        payload: { type: "session.status", properties: { sessionID: "ses_sidebar_066", status: { type: "busy" } } },
      },
      {
        directory,
        payload: {
          type: "permission.asked",
          properties: {
            id: "per_sidebar",
            sessionID: "ses_sidebar_067",
            permission: "bash",
            patterns: ["*"],
            always: [],
            metadata: {},
          },
        },
      },
      {
        directory,
        payload: {
          type: "session.error",
          properties: {
            sessionID: "ses_sidebar_068",
            error: { name: "UnknownError", data: { message: "Test failure" } },
          },
        },
      },
      { directory, payload: { type: "session.idle", properties: { sessionID: "ses_sidebar_069" } } },
    ],
  })
  await page.addInitScript(
    ({ directory, draftID, server }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem("opencode-theme-id", "oc-2")
      localStorage.setItem("opencode-color-scheme", "dark")
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "draft", draftID, server, directory }]),
      )
    },
    { directory, draftID, server },
  )
})

test("matches the rounded panel corners to the dark new-session background", async ({ page }, testInfo) => {
  await page.goto(`/new-session?draftId=${draftID}`)
  await expectAppVisible(page.locator('[data-component="prompt-input"]'))
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
  const panel = page.locator('main div[class*="rounded-[10px]"][class*="overflow-hidden"]')
  await expect(panel).toHaveCount(1)
  const box = await panel.boundingBox()
  if (!box) throw new Error("New-session panel bounds are unavailable")

  const screenshot = await page.screenshot({ path: testInfo.outputPath("new-session-dark.png") })
  const corners = await page.evaluate(
    async ({ source, points }) => {
      const image = new Image()
      image.src = source
      await image.decode()
      const canvas = document.createElement("canvas")
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext("2d")
      if (!context) throw new Error("2D canvas is unavailable")
      context.drawImage(image, 0, 0)
      return points.map((point) => Array.from(context.getImageData(point.x, point.y, 1, 1).data))
    },
    {
      source: `data:image/png;base64,${screenshot.toString("base64")}`,
      points: [
        { x: Math.floor(box.x), y: Math.floor(box.y) },
        { x: Math.ceil(box.x + box.width) - 1, y: Math.floor(box.y) },
        { x: Math.floor(box.x), y: Math.ceil(box.y + box.height) - 1 },
        { x: Math.ceil(box.x + box.width) - 1, y: Math.ceil(box.y + box.height) - 1 },
      ],
    },
  )

  expect(corners.every(([red, green, blue, alpha]) => red === 24 && green === 24 && blue === 24 && alpha === 255)).toBe(true)
  await expect(panel).toHaveCSS("background-color", "rgb(24, 24, 24)")
})

test("keeps all project chats under the project and preserves the composer when collapsed", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/new-session?draftId=${draftID}`)
  const sidebar = page.locator('[data-component="project-sidebar"]')
  const project = sidebar.locator('[data-component="home-project-row"]')
  const disclosure = sidebar.locator('[data-action="home-project-collapse"]')
  const chats = sidebar.locator('[data-component="home-session-row"]')
  const toggle = page.getByRole("button", { name: "Toggle sidebar", exact: true })
  const composer = page.locator('[data-component="prompt-input"]')
  await expect(composer).toBeVisible()
  await expect(disclosure).toHaveAttribute("aria-expanded", "true")
  await expect(chats).toHaveCount(70)
  await sidebar.evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)))
  await expect(chats.filter({ hasText: /^Project chat 70$/ }).locator('[data-status="complete"]')).toBeVisible()
  const projectBox = await project.boundingBox()
  const disclosureBox = (await disclosure.boundingBox())!
  expect(disclosureBox.width).toBeCloseTo(disclosureBox.height, 1)
  expect(disclosureBox.height).toBeCloseTo(projectBox!.height, 1)
  await expect(project).toHaveAttribute("aria-current", "page")
  await expect(sidebar.locator('[data-component="sidebar-draft-row"]')).toHaveCount(0)
  const chatBox = await chats.filter({ hasText: /^Project chat 70$/ }).boundingBox()
  expect(chatBox!.x).toBeCloseTo(disclosureBox.x, 1)
  expect(chatBox!.x + chatBox!.width).toBeCloseTo(projectBox!.x + projectBox!.width, 1)
  const settingsBox = await sidebar.getByRole("button", { name: "Settings", exact: true }).boundingBox()
  expect(chatBox!.y).toBeGreaterThan(projectBox!.y)
  expect(settingsBox!.y).toBeGreaterThan(750)
  await page.screenshot({ path: testInfo.outputPath("sidebar-expanded.png") })
  await project.click()
  await expect(chats).toHaveCount(70)
  await disclosure.click()
  await expect(disclosure).toHaveAttribute("aria-expanded", "false")
  await expect(project.locator('[data-component="project-working"]')).toBeVisible()
  await expect(chats).toHaveCount(0)
  await project.click()
  await expect(chats).toHaveCount(0)
  await disclosure.click()
  await expect(project.locator('[data-component="project-working"]')).toHaveCount(0)
  await expect(chats).toHaveCount(70)
  await sidebar.getByRole("searchbox", { name: "Search sessions" }).fill("Project chat 1")
  await expect(chats).toHaveCount(11)
  await sidebar.getByRole("searchbox", { name: "Search sessions" }).clear()
  await expect(chats).toHaveCount(70)
  await expect(page.locator('[data-slot="titlebar-tabs"]')).toHaveCount(0)
  await expect(sidebar).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  await expect(sidebar).toHaveCSS("border-right-width", "0px")
  const separator = sidebar.getByRole("separator")
  const width = (await sidebar.boundingBox())!.width
  await separator.press("ArrowRight")
  await expect(sidebar).toHaveCSS("width", `${width + 16}px`)
  await separator.hover()
  await expect.poll(() => separator.evaluate((element) => getComputedStyle(element, "::after").opacity)).toBe("1")
  expect(await separator.evaluate((element) => getComputedStyle(element, "::after").borderRadius)).toBe("999px")
  await page.screenshot({ path: testInfo.outputPath("rounded-left-resize.png") })
  const handle = (await separator.boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 100)
  await page.mouse.down()
  await expect(separator).toHaveAttribute("data-dragging", "true")
  await page.mouse.move(100, handle.y + 100, { steps: 8 })
  await expect(page.locator('[data-component="project-sidebar-slot"]')).toHaveAttribute("data-collapsing", "true")
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 100, { steps: 8 })
  await page.mouse.up()
  await expect(separator).toHaveAttribute("data-dragging", "false")
  const editor = composer
  await editor.fill("Keep this draft")
  await expect(project).not.toHaveAttribute("aria-current", "page")
  await expect(sidebar.locator('[data-component="sidebar-draft-row"]')).toHaveText("Keep this draft")
  await expect(sidebar.locator('[data-component="sidebar-draft-row"]')).toHaveAttribute("aria-current", "page")
  await chats.filter({ hasText: /^Project chat 70$/ }).click()
  await expect(page).toHaveURL(/\/session\/ses_sidebar_069$/)
  await expect(page.locator('main div.bg-v2-background-bg-base.rounded-\\[10px\\]')).toHaveCSS(
    "background-color",
    "rgb(32, 32, 32)",
  )
  await expect(chats.filter({ hasText: /^Project chat 70$/ }).locator('[data-status="complete"]')).toHaveCount(0)
  await chats.filter({ hasText: /^Project chat 69$/ }).hover()
  await expect(chats.filter({ hasText: /^Project chat 69$/ })).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  await project.hover()
  await project.evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)))
  const projectHover = await project.evaluate((el) => getComputedStyle(el).backgroundColor)
  await disclosure.hover()
  await expect(disclosure).toHaveCSS("background-color", projectHover)
  await expect(project).not.toHaveAttribute("aria-current", "page")
  await expect(sidebar.locator('[data-component="sidebar-draft-row"]')).not.toHaveAttribute("aria-current", "page")
  await expect(page.locator('[data-slot="titlebar-tabs"]')).toHaveCount(0)
  await sidebar.locator('[data-component="sidebar-draft-row"]').click()
  await expect(editor).toHaveText("Keep this draft")
  await toggle.click()
  await expect(sidebar).toBeHidden()
  await expect(toggle).toHaveAttribute("aria-pressed", "false")
  await expect(editor).toHaveText("Keep this draft")
  await page.screenshot({ path: testInfo.outputPath("sidebar-collapsed.png") })
  await page.reload({ waitUntil: "domcontentloaded" })
  await expect(toggle).toHaveAttribute("aria-pressed", "false")
  await toggle.click()
  await expect(chats).toHaveCount(70)
  await expect(sidebar).toHaveCSS("width", `${width + 16}px`)
  await chats.filter({ hasText: /^Project chat 70$/ }).click()
  await expect(page).toHaveURL(/\/session\/ses_sidebar_069$/)
  await expect(chats.filter({ hasText: /^Project chat 70$/ })).toHaveAttribute("aria-current", "page")
  await expect(composer).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("sidebar-chat.png") })
  await expect(chats.filter({ hasText: /^Project chat 67$/ }).locator('[data-status="working"]')).toBeVisible()
  await expect(chats.filter({ hasText: /^Project chat 68$/ }).locator('[data-status="waiting"]')).toBeVisible()
  await expect(chats.filter({ hasText: /^Project chat 69$/ }).locator('[data-status="error"]')).toBeVisible()
  await expect(chats.filter({ hasText: /^Project chat 70$/ }).locator('[data-status="complete"]')).toHaveCount(0)
  await expect(chats.filter({ hasText: /^Project chat 68$/ }).locator('[data-status="waiting"] > span')).toHaveCSS(
    "background-color",
    "rgb(251, 191, 36)",
  )
  await expect(chats.filter({ hasText: /^Project chat 69$/ }).locator('[data-status="error"] > span')).toHaveCSS(
    "background-color",
    "rgb(239, 68, 68)",
  )
  await page.getByRole("button", { name: "Toggle review", exact: true }).click()
  const divider = page.locator('[data-panel-resize="session"]')
  await expect(divider).toBeVisible()
  const reviewToggle = page.getByRole("button", { name: "Toggle review", exact: true })
  await page.mouse.move(700, 400)
  await reviewToggle.hover()
  await expect(page.locator('[data-component="tooltip-v2"]').filter({ hasText: "Toggle review" })).toBeVisible()
  const split = (await divider.boundingBox())!
  const leftDivider = (await sidebar.getByRole("separator").boundingBox())!
  expect(Math.abs(leftDivider.y - split.y)).toBeLessThanOrEqual(1)
  expect(Math.abs(leftDivider.height - split.height)).toBeLessThanOrEqual(1)
  const version = sidebar.locator('[data-component="sidebar-footer"] > div')
  const settingsLabel = (await sidebar.getByText("Settings", { exact: true }).boundingBox())!
  expect(Math.abs((await version.boundingBox())!.x - settingsLabel.x)).toBeLessThanOrEqual(1)
  const helpRow = (await sidebar.getByRole("button", { name: "Help", exact: true }).boundingBox())!
  const settingsRow = (await sidebar.getByRole("button", { name: "Settings", exact: true }).boundingBox())!
  expect(Math.abs((await version.boundingBox())!.y - helpRow.y - (helpRow.y - settingsRow.y))).toBeLessThanOrEqual(1)
  await version.hover()
  await expect(version).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  const chatPanel = page.locator('[data-component="session-chat-panel"]')
  const rightPanel = page.locator('[data-component="session-right-panel"]')
  const reviewContent = await page.locator("#review-panel > div").elementHandle()
  if (!reviewContent) throw new Error("Review content is unavailable")
  const toggleWithMotion = async () => {
    const widths = await reviewToggle.evaluate(async (button: HTMLButtonElement) => {
      const panel = document.querySelector('[data-component="session-chat-panel"]')!
      const before = panel.getBoundingClientRect().width
      button.click()
      await new Promise(requestAnimationFrame)
      const animation = panel.getAnimations().find((item) => item instanceof CSSTransition && item.transitionProperty === "width")
      if (!animation) throw new Error("Sidebar toggle snapped instead of animating")
      animation.pause()
      animation.currentTime = 80
      const middle = panel.getBoundingClientRect().width
      animation.finish()
      return { before, middle, after: panel.getBoundingClientRect().width }
    })
    expect(widths.middle).toBeGreaterThan(Math.min(widths.before, widths.after))
    expect(widths.middle).toBeLessThan(Math.max(widths.before, widths.after))
  }
  await toggleWithMotion()
  await expect(rightPanel).toBeHidden()
  expect(await reviewContent.evaluate((el) => el.isConnected)).toBe(true)
  await toggleWithMotion()
  expect(await reviewContent.evaluate((el) => el.isConnected)).toBe(true)
  await expect(page.locator("#review-panel")).toHaveCSS("transition-duration", "0s")
  await expect(rightPanel).toHaveCSS("transition-delay", "0s, 0s")
  await page.evaluate(() => {
    for (const selector of ['[data-component="session-right-panel"]', '[data-component="session-chat-panel"]']) {
      for (const animation of document.querySelector(selector)!.getAnimations()) {
        animation.pause()
        animation.currentTime = 80
      }
    }
  })
  await page.screenshot({ path: testInfo.outputPath("right-panel-opening.png") })
  await page.evaluate(() => {
    for (const selector of ['[data-component="session-right-panel"]', '[data-component="session-chat-panel"]']) {
      for (const animation of document.querySelector(selector)!.getAnimations()) animation.finish()
    }
  })
  for (const property of ["transition-duration", "transition-timing-function"]) {
    await expect(rightPanel).toHaveCSS(
      property,
      await sidebar.evaluate((el, key) => getComputedStyle(el).getPropertyValue(key), property),
    )
    await expect(chatPanel).toHaveCSS(
      property,
      await page
        .locator('[data-component="project-sidebar-slot"]')
        .evaluate((el, key) => getComputedStyle(el).getPropertyValue(key), property),
    )
  }
  const panel = (await chatPanel.boundingBox())!
  await page.mouse.move(split.x + split.width / 2, split.y + 100)
  await page.mouse.down()
  await page.mouse.move(panel.x + 20, split.y + 100, { steps: 10 })
  await expect(chatPanel).toHaveCSS("width", "0px")
  await page.mouse.up()
  await expect(sidebar).toBeVisible()
  await expect(divider).toHaveCount(0)
  const restoreChat = page.getByRole("button", { name: "Show chat", exact: true })
  await expect(page.locator("#opencode-titlebar-left-actions").getByRole("button", { name: "Show chat" })).toBeVisible()
  const restoreBox = (await restoreChat.boundingBox())!
  const toggleBox = (await toggle.boundingBox())!
  expect(restoreBox.x).toBeGreaterThan(toggleBox.x + toggleBox.width)
  expect(restoreBox.x - toggleBox.x - toggleBox.width).toBeLessThan(20)
  await expect(restoreChat.locator('[data-slot="icon-svg"]')).toHaveCSS("transform", "matrix(0, 1, -1, 0, 0, 0)")
  await expect(page.locator(".session-review-v2-tabs-bar")).toHaveCSS("border-bottom-color", "rgb(59, 59, 59)")
  await page.getByRole("button", { name: "Show chat", exact: true }).click()
  await expect(divider).toBeVisible()
  await divider.hover()
  await expect.poll(() => divider.evaluate((element) => getComputedStyle(element, "::after").opacity)).toBe("1")
  expect(await divider.evaluate((element) => getComputedStyle(element, "::after").borderRadius)).toBe("999px")
  await page.screenshot({ path: testInfo.outputPath("rounded-right-resize.png") })
  await page.mouse.down()
  await page.mouse.move(40, split.y + 100, { steps: 10 })
  await page.mouse.up()
  await expect(sidebar).toBeHidden()
  await expect(divider).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath("right-panel-full-width.png") })
  await page.getByRole("button", { name: "Show chat", exact: true }).click()
  await expect(divider).toBeVisible()
  await divider.hover()
  await page.mouse.down()
  await page.mouse.move(1430, split.y + 100, { steps: 10 })
  await page.mouse.up()
  await expect(divider).toHaveCount(0)
  await expect(composer).toBeVisible()
})

test("shows the ArezaCode wordmark on new chats", async ({ page }, testInfo) => {
  await page.goto(`/new-session?draftId=${draftID}`)
  await expect(page.getByRole("img", { name: "ArezaCode", exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("arezacode-new-chat.png") })
})

test("brands the error page and links to ArezaCode support", async ({ page }, testInfo) => {
  await page.route("**/src/pages/new-session.tsx*", async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, body: `throw new SyntaxError("Branding preview");\n${await response.text()}` })
  })
  await page.goto(`/new-session?draftId=${draftID}`)
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible()
  await expect(page.getByRole("img", { name: "ArezaCode", exact: true })).toBeVisible()
  await expect(page.getByText("Please report this error to the ArezaCode team", { exact: false })).toBeVisible()
  await expect(page.getByRole("button", { name: "on GitHub", exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("arezacode-error.png") })
})

test("keeps project items close to their section headings", async ({ page }, testInfo) => {
  await page.goto(`/new-session?draftId=${draftID}`)
  const sidebar = page.locator('[data-component="project-sidebar"]')
  await sidebar.locator('[data-component="home-project-row"]').click({ button: "right" })
  await page.getByRole("menuitem", { name: "Close", exact: true }).click()
  const recent = sidebar.locator('[data-component="home-recently-closed-row"]')
  await expect(recent).toBeVisible()
  for (const [heading, row] of [
    ["Projects", '[data-action="home-add-project-row"]'],
    ["Recently closed", '[data-component="home-recently-closed-row"]'],
  ]) {
    const bottom = await sidebar.getByText(heading, { exact: true }).evaluate((el) => el.parentElement!.getBoundingClientRect().bottom)
    expect((await sidebar.locator(row).boundingBox())!.y - bottom).toBeCloseTo(4, 0)
  }
  await page.screenshot({ path: testInfo.outputPath("sidebar-section-spacing.png") })
})

test("uses matching tooltips for the sidebar toggle and status", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true, showStatus: true } }))
  })
  await page.goto(`/new-session?draftId=${draftID}`)
  await expectAppVisible(page.locator('[data-component="prompt-input"]'))
  await expect(page.locator('[data-component="prompt-input-v2"]')).toHaveCSS("background-color", "rgb(40, 40, 40)")
  const toggle = page.getByRole("button", { name: "Toggle sidebar", exact: true })
  const tooltip = page.locator('[data-component="tooltip-v2"]')
  await expect(toggle).toHaveAttribute("aria-pressed", "true")
  await toggle.hover()
  await expect(tooltip).toContainText("Toggle sidebar")
  const style = await tooltip.evaluate((el) => {
    const css = getComputedStyle(el)
    return [css.fontSize, css.backgroundColor, css.borderRadius]
  })
  await page.screenshot({ path: testInfo.outputPath("left-sidebar-tooltip.png") })
  await page.mouse.move(500, 400)
  await expect(tooltip).toBeHidden()
  await toggle.click()
  await page.locator('[contenteditable="true"]').first().click()
  await toggle.hover()
  await expect(tooltip).toContainText("Toggle sidebar")
  await page.getByRole("button", { name: "Status", exact: true }).hover()
  await expect(tooltip).toHaveText("Status")
  expect(await tooltip.evaluate((el) => {
    const css = getComputedStyle(el)
    return [css.fontSize, css.backgroundColor, css.borderRadius]
  })).toEqual(style)
  await page.screenshot({ path: testInfo.outputPath("status-tooltip.png") })
  await page.getByRole("button", { name: "Status", exact: true }).click()
  await expect(tooltip).toBeHidden()
})

test("scrolls overflowing sidebar titles to the end and resets them on leave", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/new-session?draftId=${draftID}`)
  const sidebar = page.locator('[data-component="project-sidebar"]')
  for (const row of [
    sidebar.locator('[data-component="home-project-row"]'),
    sidebar.locator('[data-component="home-session-row"]').filter({ hasText: "Project chat 65 with" }),
  ]) {
    const title = row.locator('[data-component="sidebar-title"]')
    await title.hover()
    const overflow = await title.evaluate((el) => Number.parseFloat(el.style.getPropertyValue("--title-overflow")))
    expect(overflow).toBeGreaterThan(0)
    const text = title.locator("span")
    await expect.poll(() => text.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41)).toBeLessThan(0)
    await text.evaluate((el) => el.getAnimations().forEach((animation) => animation.finish()))
    expect(await text.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41)).toBeCloseTo(-overflow, 0)
    await page.screenshot({ path: testInfo.outputPath(`title-end-${await row.getAttribute("data-component")}.png`) })
    await page.mouse.move(700, 50)
    await expect(text).toHaveCSS("transform", "none")
  }
  await page.emulateMedia({ reducedMotion: "reduce" })
  const title = sidebar.locator('[data-component="home-project-row"] [data-component="sidebar-title"]')
  await title.hover()
  await expect(title.locator("span")).toHaveCSS("transform", "none")
})
