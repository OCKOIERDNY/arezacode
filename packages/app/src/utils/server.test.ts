import { describe, expect, test } from "bun:test"
import { authFromToken, authTokenFromCredentials, createSdkForServer } from "./server"

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
