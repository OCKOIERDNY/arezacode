import { describe, expect, test } from "bun:test"
import { authFromToken, authTokenFromCredentials, createApiForServer, createApprovalApiForServer, createSdkForServer } from "./server"

test("session preferences share generated transport, authorization, and error handling", async () => {
  const requests: Request[] = []
  const input = {
    server: { url: "http://localhost:4096", username: "test", password: "fixture-password" },
    fetch: Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
      const request = new Request(url, init)
      requests.push(request)
      if (request.url.includes("missing")) return Response.json({ message: "Session not found" }, { status: 404 })
      if (request.method === "GET") return Response.json({ data: { id: "ses_1", approvalMode: "ask", instructions: "Use Bun" } })
      return new Response(null, { status: 204 })
    }, { preconnect: globalThis.fetch.preconnect }),
  }
  const approval = createApprovalApiForServer(input)
  const api = createApiForServer(input)
  expect(await approval.get("ses_1")).toBe("ask")
  await approval.set("ses_1", "auto")
  expect(await api.session.getInstructions({ sessionID: "ses_1" })).toBe("Use Bun")
  await api.session.setInstructions({ sessionID: "ses_1", instructions: "" })
  expect(await requests[1]?.json()).toEqual({ mode: "auto" })
  expect(await requests[3]?.json()).toEqual({ instructions: "" })
  expect(requests.every((request) => request.headers.get("Authorization") === `Basic ${btoa("test:fixture-password")}`)).toBe(true)
  await expect(api.session.getInstructions({ sessionID: "missing" })).rejects.toThrow()
})

test("preserves tuple-form request headers instead of spreading their numeric indices", async () => {
  const requests: Request[] = []
  const client = createSdkForServer({
    server: { url: "http://localhost:4096" },
    headers: [["x-request-test", "tuple-header"]],
    fetch: Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init))
      return Response.json([])
    }, { preconnect: globalThis.fetch.preconnect }),
  })
  await client.session.list()
  expect(requests[0].headers.get("x-request-test")).toBe("tuple-header")
  expect(requests[0].headers.has("0")).toBe(false)
})

describe("authFromToken", () => {
  test("decodes basic auth credentials from auth_token", () => {
    expect(authFromToken(btoa("kit:secret"))).toEqual({ username: "kit", password: "secret" })
  })

  test("defaults blank username to opencode", () => {
    expect(authFromToken(btoa(":secret"))).toEqual({ username: "opencode", password: "secret" })
  })

  test("ignores malformed tokens", () => {
    expect(authFromToken("not base64")).toBeUndefined()
    expect(authFromToken(btoa("missing-separator"))).toBeUndefined()
  })
})

describe("authTokenFromCredentials", () => {
  test("encodes credentials with the default username", () => {
    expect(authTokenFromCredentials({ password: "secret" })).toBe(btoa("opencode:secret"))
  })
})
