import { afterEach, expect, test } from "bun:test"
import { Context } from "effect"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

test("Tools HTTP handlers report native engines, persist toggles and reject unsafe documentation sources", async () => {
  const request = (suffix: string, method = "GET", body?: unknown) => HttpApiApp.webHandler().handler(
    new Request(`http://localhost/api/tools${suffix}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), Context.empty() as Context.Context<unknown>,
  )
  const response = await request("")
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: "ponytail", installed: true, managed: true })]))
  const disabled = await request("/ponytail", "POST", { action: "disable" })
  expect(disabled.status).toBe(200)
  expect(await disabled.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: "ponytail", enabled: false })]))
  expect((await request("/ponytail", "POST", { action: "enable" })).status).toBe(200)
  expect((await request("/unknown", "POST", { action: "enable" })).status).toBe(400)
  expect((await request("/docs/sources")).status).toBe(200)
  expect((await request("/docs/sources", "POST", { library: "test", version: "1.0.0", url: "https://127.0.0.1/private" })).status).toBe(400)
  expect((await request("/docs/search", "POST", { library: "unindexed-test", version: "1.0.0", query: "test" })).status).toBe(400)
})

test("Jev settings and prepare use the real HTTP handlers without requiring a key", async () => {
  await using directory = await tmpdir({ git: true })
  const request = (suffix: string, method: string, body?: unknown) => HttpApiApp.webHandler().handler(
    new Request(`http://localhost/api/jev${suffix}`, {
      method,
      headers: { "content-type": "application/json", "x-opencode-directory": directory.path },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), Context.empty() as Context.Context<unknown>,
  )
  const initial = await request("", "GET")
  expect(initial.status).toBe(200)
  const settings = await initial.json() as Record<string, unknown>
  expect(settings.enabled).toBe(false)
  expect(settings).not.toHaveProperty("apiKey")
  const update = await request("", "PATCH", { ...settings, enabled: true })
  expect(update.status).toBe(200)
  expect(await update.json()).toMatchObject({ enabled: true, configured: false })
  const prepared = await request("/prepare", "POST", {
    sessionID: "ses_jev", text: "Fix a typo", agent: "build", auto: true, models: [],
  })
  expect(prepared.status).toBe(200)
  expect(await prepared.json()).toEqual({ status: "missing-key", skills: [] })
  expect((await request("", "PATCH", { enabled: "invalid" })).status).toBe(400)
  const connection = (method: string, body?: unknown) => HttpApiApp.webHandler().handler(
    new Request("http://localhost/auth/openrouter", {
      method,
      headers: { "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), Context.empty() as Context.Context<unknown>,
  )
  expect((await connection("PUT", { type: "api", key: "provider-test-only-key" })).status).toBe(200)
  expect(await (await request("", "GET")).json()).toMatchObject({ configured: true })
  expect((await connection("DELETE")).status).toBe(200)
  expect(await (await request("", "GET")).json()).toMatchObject({ configured: false })
})
