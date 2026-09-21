import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { setupTimelineBenchmark } from "../performance/timeline/session-timeline-benchmark.fixture"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

test.use({ colorScheme: "dark" })

test("drags the changed-files preview with the shared scrollbar", async ({ page }) => {
  await setupTimelineBenchmark(page, {
    historyTurns: 2,
    eventBatch: 1,
    newLayoutDesigns: true,
    vcsDiff: Array.from({ length: 106 }, (_, index) => ({
      file: `packages/app/src/components/file-${index}.tsx`, status: "modified", additions: 2, deletions: 1,
    })),
  })
  await page.locator('[data-slot="chat-changes"]').hover()
  const preview = page.locator('[data-component="chat-changes-preview"]')
  await expect(preview).toBeVisible()
  await preview.hover()
  await expect(preview).toHaveCSS("overflow", "hidden")
  const viewport = preview.locator(".scroll-view__viewport")
  await expect(viewport).toHaveCSS("scrollbar-width", "none")
  const thumb = preview.locator('.scroll-view__thumb[data-orientation="vertical"]')
  const bounds = (await thumb.boundingBox())!
  await page.mouse.move(bounds.x + 6, bounds.y + 8)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 6, bounds.y + 230, { steps: 12 })
  await page.mouse.up()
  await expect(preview).toBeVisible()
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(3000)
  await page.screenshot({ path: "/tmp/areza-changes-shared-scrollbar.png" })
})

test("updates the chat thumb when content after the header changes height", async ({ page }) => {
  const { scroller } = await setupTimelineBenchmark(page, { historyTurns: 0, eventBatch: 1, newLayoutDesigns: true })
  await scroller.hover()
  const thumb = page.locator('.message-timeline-scroll > .scroll-view__thumb[data-orientation="vertical"]')
  await scroller.evaluate((element) => {
    const content = document.createElement("div")
    content.dataset.scrollResizeProbe = ""
    content.style.height = "2000px"
    element.append(content)
  })
  await expect(thumb).toBeVisible()
  const height = (await thumb.boundingBox())!.height
  await scroller.locator("[data-scroll-resize-probe]").evaluate((element) => {
    element.style.height = "4000px"
  })
  await expect.poll(async () => (await thumb.boundingBox())!.height).toBeLessThan(height - 10)
  await expect(scroller).toHaveCSS("scrollbar-width", "none")
  await page.screenshot({ path: "/tmp/areza-chat-shared-scrollbar.png" })
})

test("uses the shared scrollbar for a long diff and renders file buffers with the code background", async ({
  page,
}) => {
  const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4446"}`
  const contents = Array.from(
    { length: 3000 },
    (_, index) => `export const line${index} = "${"file content ".repeat(16)}"`,
  ).join("\n")
  await mockOpenCodeServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
    fileContent: () => ({ type: "text", content: contents }),
    fileList: () => [],
    vcsDiff: [
      {
        file: "src/scroll.ts",
        status: "modified",
        additions: 3000,
        deletions: 1,
        patch: `diff --git a/src/scroll.ts b/src/scroll.ts\n--- a/src/scroll.ts\n+++ b/src/scroll.ts\n@@ -1 +1,3000 @@\n-export const before = true\n${contents
          .split("\n")
          .map((line) => `+${line}`)
          .join("\n")}\n`,
      },
    ],
  })
  await page.addInitScript(
    ({ server, route }) => {
      localStorage.setItem("opencode.settings.dat:defaultServerUrl", server)
      localStorage.setItem("opencode.global.dat:server", JSON.stringify({ list: [server] }))
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      const tabs = { all: ["review", "file://src/scroll.ts"], active: "file://src/scroll.ts" }
      localStorage.setItem(
        "layout.v6",
        JSON.stringify({
          review: { panelOpened: true, diffStyle: "split" },
          sessionTabs: { [`local\u0000${route}`]: tabs, [`${server}\u0000${route}`]: tabs },
        }),
      )
      localStorage.setItem("opencode-theme-id", "oc-2")
      localStorage.setItem("opencode-color-scheme", "dark")
    },
    { server, route: `${base64Encode(fixture.directory)}/${fixture.sourceID}` },
  )
  await page.setViewportSize({ width: 1800, height: 900 })
  await page.goto(`/server/${base64Encode(server)}/session/${fixture.sourceID}`)
  await expect(page.locator('[data-component="startup-splash"]:visible')).toHaveCount(0)
  const panel = page.locator("#review-panel")
  const file = panel.locator('[data-component="file"][data-mode="text"]')
  await expect(file).toBeVisible()
  await panel.getByRole("button", { name: "Toggle file tree" }).click()
  const viewport = panel
    .locator(".scroll-view__viewport", { has: page.locator('[data-component="file"][data-mode="text"]') })
    .last()
  await viewport.hover()
  await expect(viewport).toHaveCSS("scrollbar-width", "none")
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight / 2
  })
  const background = await file.locator("..").evaluate((element) => getComputedStyle(element).backgroundColor)
  await expect(file.locator("..")).toHaveCSS("padding-bottom", "0px")
  await page.screenshot({ path: "/tmp/areza-file-shared-scrollbar.png" })
  await panel.locator("#session-side-panel-review-tab").click()
  const diff = panel.locator('[data-slot="session-review-v2-diff-scroll"]')
  const diffViewport = diff.locator(":scope > .scroll-view__viewport")
  await expect(diffViewport).toHaveCSS("scrollbar-width", "none")
  await diffViewport.hover()
  await expect(diff.locator(':scope > .scroll-view__thumb[data-orientation="vertical"]')).toBeVisible()
  await panel.getByRole("button", { name: "Split diff", exact: true }).click()
  await diffViewport.hover()
  await page.mouse.wheel(0, 1400)
  await expect.poll(() => diffViewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(500)
  const buffer = diff.locator("[data-content-buffer]").first()
  await expect(buffer).toBeAttached()
  await expect.poll(() => buffer.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(background)
  await page.screenshot({ path: "/tmp/areza-diff-shared-scrollbar.png" })
})
