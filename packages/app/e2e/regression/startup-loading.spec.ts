import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.use({ colorScheme: "dark" })

for (const opened of [false, true]) {
  test(`holds the flower until chat and ${opened ? "visible" : "background"} review are ready`, async ({ page }) => {
    const messages = Promise.withResolvers<void>()
    const details = Promise.withResolvers<void>()
    const session = Promise.withResolvers<void>()
    let messageRequests = 0
    let diffRequests = 0
    await mockOpenCodeServer(page, {
      sessions: fixture.sessions,
      provider: fixture.provider,
      directory: fixture.directory,
      project: fixture.project,
      pageMessages,
      vcsDiff: [{
        file: "src/startup.ts",
        status: "modified",
        additions: 1,
        deletions: 1,
        patch: "diff --git a/src/startup.ts b/src/startup.ts\n--- a/src/startup.ts\n+++ b/src/startup.ts\n@@ -1 +1 @@\n-export const ready = false\n+export const ready = true\n",
      }],
      beforeMessagesResponse: () => messages.promise,
      onMessages: ({ phase }) => {
        if (phase === "start") messageRequests++
      },
    })
    await page.route(`**/session/${fixture.sourceID}`, async (route) => {
      if (route.request().isNavigationRequest()) return route.fallback()
      await session.promise
      return route.fallback()
    })
    await page.route("**/vcs/diff**", async (route) => {
      diffRequests++
      await details.promise
      return route.fallback()
    })
    await page.addInitScript(
      ({ opened, server }) => {
        localStorage.setItem("opencode.settings.dat:defaultServerUrl", server)
        localStorage.setItem("opencode.global.dat:server", JSON.stringify({ list: [server] }))
        localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
        localStorage.setItem("layout.v6", JSON.stringify({ review: { panelOpened: opened, diffStyle: "split" } }))
        localStorage.setItem("opencode-theme-id", "oc-2")
        localStorage.setItem("opencode-color-scheme", "dark")
      },
      { opened, server },
    )
    await page.goto(`/server/${base64Encode(server)}/session/${fixture.sourceID}`)
    const splash = page.locator('[data-component="startup-splash"]:visible')
    try {
      await expect.poll(() => messageRequests).toBeGreaterThan(0)
      await expect(splash).toHaveCount(1)
      await expect
        .poll(() => splash.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBeGreaterThan(0)
      const metadata = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname.endsWith(`/session/${fixture.sourceID}`) &&
          !response.request().isNavigationRequest(),
      )
      session.resolve()
      await metadata
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      )
      await expect(splash).toHaveCount(1)
      await page.screenshot({ path: `/tmp/areza-startup-flower-${opened}.png` })
      messages.resolve()
      await expect.poll(() => diffRequests).toBeGreaterThan(0)
      if (opened) await expect(splash).toHaveCount(1)
      else await expect(splash).toHaveCount(0)
      details.resolve()
      await expect(splash).toHaveCount(0)
      await expect(page.getByRole("heading", { name: fixture.expected.sourceTitle })).toBeVisible()
      if (!opened) await page.getByRole("button", { name: "Toggle review", exact: true }).click()
      await expect(page.locator('[data-component="session-right-panel"]')).toHaveAttribute("data-opened", "true")
      await page.screenshot({ path: `/tmp/areza-startup-ready-${opened}.png` })
    } finally {
      session.resolve()
      messages.resolve()
      details.resolve()
    }
  })
}

test("waits for a restored file without waiting for the hidden review renderer", async ({ page }) => {
  const content = Promise.withResolvers<void>()
  let requested = false
  await mockOpenCodeServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
    fileContent: async () => {
      requested = true
      await content.promise
      return { type: "text", content: "export const restored = true" }
    },
  })
  await page.addInitScript(
    ({ server, route }) => {
      localStorage.setItem("opencode.settings.dat:defaultServerUrl", server)
      localStorage.setItem("opencode.global.dat:server", JSON.stringify({ list: [server] }))
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      const tabs = { all: ["file://src/startup.ts"], active: "file://src/startup.ts" }
      localStorage.setItem("layout.v6", JSON.stringify({
        review: { panelOpened: true, diffStyle: "split" },
        sessionTabs: { [`local\u0000${route}`]: tabs, [`${server}\u0000${route}`]: tabs },
      }))
    },
    { server, route: `${base64Encode(fixture.directory)}/${fixture.sourceID}` },
  )
  try {
    await page.goto(`/server/${base64Encode(server)}/session/${fixture.sourceID}`)
    await expect.poll(() => requested).toBe(true)
    await expect(page.locator('[data-component="startup-splash"]:visible')).toHaveCount(1)
    content.resolve()
    await expect(page.locator('[data-component="startup-splash"]:visible')).toHaveCount(0)
    await expect(page.getByRole("heading", { name: fixture.expected.sourceTitle })).toBeVisible()
    await expect(page.locator('[data-component="session-right-panel"]')).toHaveAttribute("data-opened", "true")
  } finally {
    content.resolve()
  }
})
