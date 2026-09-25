import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/NewProject"

test("restores collapsed model providers before displaying them", async ({ page }, testInfo) => {
  await mockOpenCodeServer(page, {
    directory,
    project: { id: "proj_model_accordion", worktree: directory, vcs: "git", name: "NewProject", time: { created: 1, updated: 1 }, sandboxes: [] },
    sessions: [],
    pageMessages: () => ({ items: [] }),
    provider: {
      all: [{ id: "opencode", name: "OpenCode Zen", models: {
        "zen-model": { id: "zen-model", name: "Zen Model", cost: { input: 0, output: 0 }, limit: { context: 200_000 } },
      } }],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "zen-model" },
    },
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  await page.route("**/src/entry.tsx", async (route) => {
    const response = await route.fetch()
    const source = await response.text()
    expect(source).toContain('platform: "web",')
    await route.fulfill({ response, body: source.replace('platform: "web",', `platform: "desktop",
      os: "macos",
      storage: (name) => ({
        getItem: async (key) => {
          if (key.includes("settings-v2.models.providers")) {
            document.documentElement.dataset.modelStorage = "pending";
            await new Promise((resolve) => document.addEventListener("release-model-storage", resolve, { once: true }));
            return localStorage.getItem(name + ":" + key) ?? JSON.stringify({ collapsed: { opencode: true } });
          }
          return localStorage.getItem(name + ":" + key) ?? localStorage.getItem(key);
        },
        setItem: async (key, value) => localStorage.setItem(name + ":" + key, value),
        removeItem: async (key) => localStorage.removeItem(name + ":" + key),
      }),`) })
  })
  await page.goto("/")
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const dialog = page.locator(".settings-v2-dialog")
  await dialog.getByRole("tab", { name: "Models", exact: true }).click()
  await expect(page.locator("html")).toHaveAttribute("data-model-storage", "pending")
  await expect(dialog.locator(".settings-v2-models-status")).toContainText("Loading")
  await expect(dialog.locator('[data-component="settings-models-provider"]')).toHaveCount(0)
  await page.evaluate(() => document.dispatchEvent(new Event("release-model-storage")))
  const provider = dialog.getByRole("button", { name: "OpenCode Zen", exact: true })
  await expect(provider).toHaveAttribute("aria-expanded", "false")
  await page.screenshot({ path: testInfo.outputPath("restored-collapsed-provider.png") })
  await provider.click()
  await expect(provider).toHaveAttribute("aria-expanded", "true")
  await expect(dialog.getByRole("switch", { name: "Zen Model", exact: true })).toBeVisible()
  await provider.click()
  await expect(provider).toHaveAttribute("aria-expanded", "false")
  const search = dialog.getByRole("searchbox")
  await search.fill("Zen Model")
  await expect(provider).toHaveAttribute("aria-expanded", "true")
  await search.fill("")
  await expect(provider).toHaveAttribute("aria-expanded", "false")
})

test("creates a session in a new project, connects OpenCode Go, and selects its model", async ({ page }) => {
  let connectedGo = false
  let pendingGo = false
  const connections: Array<{ integrationID: string; body: unknown }> = []

  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_model_selection_flow",
      worktree: directory,
      vcs: "git",
      name: "NewProject",
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      sandboxes: [],
    },
    provider: () => ({
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "free-model": {
              id: "free-model",
              name: "Free Model",
              cost: { input: 0, output: 0 },
              limit: { context: 200_000 },
            },
          },
        },
        {
          id: "opencode-go",
          name: "OpenCode Go",
          models: {
            "go-model-1": {
              id: "go-model-1",
              name: "Go Model 1",
              cost: { input: 1, output: 1 },
              limit: { context: 200_000 },
            },
          },
        },
      ],
      connected: connectedGo ? ["opencode", "opencode-go"] : ["opencode"],
      default: { providerID: "opencode", modelID: "free-model" },
    }),
    integrationMethods: { "opencode-go": [{ type: "api", label: "API key" }] },
    onConnectKey: (input) => {
      connections.push(input)
      if (input.integrationID === "opencode-go") pendingGo = true
    },
    onInstanceDispose: () => {
      if (pendingGo) connectedGo = true
    },
    sessions: [],
    pageMessages: () => ({ items: [] }),
    fileList: (path) =>
      path ? [] : [{ name: "NewProject", path: "NewProject", absolute: directory, type: "directory", ignored: false }],
    findFiles: () => ["NewProject"],
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem("opencode.global.dat:server", JSON.stringify({ projects: { local: [] } }))
  })

  await page.goto("/")
  const addProject = page.locator('[data-action="home-add-project-row"]')
  await expectAppVisible(addProject)
  await addProject.click()
  await page.locator("[data-directory-path]").click()

  await page.locator('[data-action="home-new-session"]').click()
  await expectAppVisible(page.locator('[data-component="prompt-input-v2"]'))

  const modelControl = page.locator('[data-action="prompt-model"]')
  await modelControl.click()
  await expect(page.locator('[data-section="free-models"]')).toContainText("Free models provided by OpenCode")

  await page.locator('[data-provider-id="opencode-go"]').click()
  await page.locator('[data-input="provider-api-key"]').fill("mock-go-api-key")
  await page.locator('[data-action="provider-connect-submit"]').click()
  await expect(page.locator('[data-component="dialog-v2"]')).toHaveCount(0)
  expect(connections).toEqual([{ integrationID: "opencode-go", body: { type: "api", key: "mock-go-api-key" } }])

  await expect(modelControl).toHaveAttribute("data-control-type", "popover")
  await modelControl.click()
  const goModel = page.locator('[data-option-key="opencode-go:go-model-1"]')
  await expect(goModel).toBeVisible()
  await goModel.click()

  await expect(modelControl).toContainText("Go Model 1")
})
