import { afterEach, expect, test } from "bun:test"
import { Context } from "effect"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

test("approval modes are persisted by the session API and invalid modes are rejected", async () => {
  await using directory = await tmpdir({ git: true })
  const request = (path: string, method: string, body?: unknown) => HttpApiApp.webHandler().handler(
    new Request(`http://localhost/api/session${path}`, {
      method,
      headers: { "content-type": "application/json", "x-opencode-directory": directory.path },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), Context.empty() as Context.Context<unknown>,
  )
  const created = await request("", "POST", { location: { directory: directory.path }, approvalMode: "ask" })
  expect(created.status).toBe(200)
  const session = await created.json() as { data: { id: string; approvalMode: string } }
  expect(session.data.approvalMode).toBe("ask")
  const path = `/${session.data.id}`
  expect((await request(`${path}/approval`, "POST", { mode: "auto" })).status).toBe(204)
  expect(await (await request(path, "GET")).json()).toMatchObject({ data: { approvalMode: "auto" } })
  expect((await request(`${path}/approval`, "POST", { mode: "invalid" })).status).toBe(400)
  expect(await (await request(path, "GET")).json()).toMatchObject({ data: { approvalMode: "auto" } })
})
