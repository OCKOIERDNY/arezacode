import { describe, expect, test } from "bun:test"
import { createApiForServer, createSdkForServer } from "./server"
import { createCompatibleApi } from "./server-compat"
import { QueryClient } from "@tanstack/solid-query"
import { loadProvidersQuery, loadAgentsQuery } from "@/context/global-sync/bootstrap"
import { ServerScope } from "./server-scope"

function setup(
  protocol: "v1" | "v2" | Promise<"v1" | "v2">,
  responses?: { vcs?: { branch: string; default_branch: string } },
) {
  const requests: Request[] = []
  const fetcher = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request)
      if (request.method === "PATCH") {
        return Response.json({
          id: "ses_1",
          slug: "ses_1",
          projectID: "project",
          directory: "/repo",
          title: "Session",
          version: "1",
          time: { created: 1, updated: 1 },
        })
      }
      if (request.method === "POST" && request.url.endsWith("/prompt_async"))
        return new Response(undefined, { status: 204 })
      if (request.method === "POST" && request.url.endsWith("/prompt")) {
        return Response.json({
          admittedSeq: 1,
          id: "msg_1",
          sessionID: "ses_1",
          timeCreated: 1,
          type: "user",
          data: { text: "hello" },
          delivery: "steer",
        })
      }
      if (request.method === "GET" && new URL(request.url).pathname === "/vcs")
        return Response.json(responses?.vcs ?? {})
      if (request.method === "GET" && new URL(request.url).pathname === "/api/session")
        return Response.json({ data: [], cursor: {} })
      if (request.method === "GET") return Response.json([])
      return new Response(undefined, { status: 204 })
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const server = { url: "http://localhost:4096" }
  const api = createCompatibleApi({
    protocol: typeof protocol === "string" ? Promise.resolve(protocol) : protocol,
    current: createApiForServer({ server, fetch: fetcher }),
    legacy: (directory) => createSdkForServer({ server, fetch: fetcher, directory, throwOnError: true }),
    directory: "/repo",
  })
  return { api, requests }
}

describe("createCompatibleApi", () => {
  test("uses the current list contract for bounded Home queries", async () => {
    const requests: Request[] = []
    const info = {
      id: "ses_recent", projectID: "project", title: "Recent", location: { directory: "/project" },
      time: { created: 1, updated: 2 }, cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      revert: { messageID: "msg_revert", files: [{ path: "notes.md", patch: "patch", additions: 1, deletions: 0, status: "modified" }] },
    }
    const api = createApiForServer({
      server: { url: "http://localhost:4096" },
      fetch: Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
        requests.push(new Request(input, init))
        return Response.json({ data: [info], cursor: {} })
      }, { preconnect: globalThis.fetch.preconnect }),
    })
    const result = await api.session.list({ directories: ["/project", "/worktree"], roots: true, archived: false, sort: "updated", order: "desc", limit: 64 })
    expect(result.data[0].revert?.files).toEqual([{ file: "notes.md", patch: "patch", additions: 1, deletions: 0, status: "modified" }])
    const url = new URL(requests[0].url)
    expect(url.pathname).toBe("/api/session")
    expect(url.searchParams.getAll("directories")).toEqual(["/project", "/worktree"])
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ roots: "true", archived: "false", sort: "updated", order: "desc", limit: "64" })
  })

  for (const protocol of ["v1", "v2"] as const) {
    test(`uses shared health and handoff endpoints for ${protocol} sessions`, async () => {
      const paths: string[] = []
      const health = { sessionID: "ses_1", inputTokens: 250_000, limit: 250_000, locked: true }
      const server = { url: "http://localhost:4096" }
      const api = createCompatibleApi({
        protocol: Promise.resolve(protocol),
        current: createApiForServer({ server, fetch: Object.assign(async (input: string | URL | Request) => {
          const path = new URL(input instanceof Request ? input.url : input).pathname
          paths.push(path)
          return Response.json(path.endsWith("/health") ? health : { text: "# Session handoff" })
        }, { preconnect: globalThis.fetch.preconnect }) }),
        legacy: () => createSdkForServer({ server }),
      })
      expect(await api.session.health({ sessionID: "ses_1" })).toEqual(health)
      expect(await api.session.handoff({ sessionID: "ses_1" })).toEqual({ text: "# Session handoff" })
      expect(paths).toEqual(["/api/session/ses_1/health", "/api/session/ses_1/handoff"])
    })
  }

  test("sends current prompt envelopes and preserves admission, mentions, headers and cancellation", async () => {
    const requests: Request[] = []
    const admission = {
      admittedSeq: 1,
      id: "msg_1",
      sessionID: "ses_1",
      timeCreated: 1,
      prompt: { text: "hello" },
      delivery: "queue" as const,
    }
    const controller = new AbortController()
    const api = createApiForServer({
      server: { url: "http://localhost:4096" },
      fetch: Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init)
        requests.push(request)
        return Response.json({ data: admission })
      }, { preconnect: globalThis.fetch.preconnect }),
    })
    const mention = { text: "@notes", start: 0, end: 6 }
    expect(await api.session.prompt({
      sessionID: "ses_1", id: "msg_1", text: "hello", delivery: "queue", resume: false,
      files: [{ uri: "file:///repo/notes", name: "notes", mention }],
      agents: [{ name: "build", mention }],
    }, { signal: controller.signal, headers: { "x-request-test": "current" } })).toEqual(admission)
    expect(new URL(requests[0].url).pathname).toBe("/api/session/ses_1/prompt")
    expect(await requests[0].json()).toEqual({
      id: "msg_1", delivery: "queue", resume: false,
      prompt: { text: "hello", files: [{ uri: "file:///repo/notes", name: "notes", source: mention }], agents: [{ name: "build", source: mention }] },
    })
    expect(requests[0].headers.get("x-request-test")).toBe("current")
    controller.abort()
    expect(requests[0].signal.aborted).toBe(true)
  })

  test("loads the current catalog without the removed default-model route", async () => {
    const paths: string[] = []
    const api = createApiForServer({
      server: { url: "http://localhost:4096" },
      fetch: Object.assign(async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : input)
        paths.push(url.pathname)
        expect(url.searchParams.get("location[directory]")).toBe("/repo")
        const location = { directory: "/repo", project: { id: "project", directory: "/repo" } }
        if (url.pathname === "/api/provider") return Response.json({ location, data: [{
          id: "openai", name: "OpenAI", api: { type: "native", settings: {} }, request: { headers: {}, body: {} },
        }] })
        if (url.pathname === "/api/model") return Response.json({ location, data: [{
          id: "model", providerID: "openai", name: "Model", api: { type: "native", id: "wire-model", settings: {} },
          request: { headers: { "x-model": "value" }, body: { temperature: 0.5 } }, variants: [{ id: "low", headers: {}, body: { reasoning: { effort: "low" } } }],
          capabilities: { tools: true, input: ["text", "image"], output: ["text"] }, time: { released: 0 }, cost: [], status: "active", enabled: true, limit: { context: 100_000, output: 4096 },
        }] })
        if (url.pathname === "/api/agent") return Response.json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [], request: { headers: {}, body: { temperature: 0.5 } } }] })
        throw new Error(`Unexpected route: ${url.pathname}`)
      }, { preconnect: globalThis.fetch.preconnect }),
    })
    const queries = new QueryClient()
    const providers = await queries.fetchQuery(loadProvidersQuery(ServerScope.local, "/repo", api))
    const agents = await queries.fetchQuery(loadAgentsQuery(ServerScope.local, "/repo", api.agent))
    expect(paths.sort()).toEqual(["/api/agent", "/api/model", "/api/provider"])
    expect(providers.all.get("openai")?.models.model).toMatchObject({ api: { id: "wire-model" }, options: { temperature: 0.5 }, variants: { low: { reasoning: { effort: "low" } } } })
    expect(agents[0]).toMatchObject({ name: "build", temperature: 0.5 })
    queries.clear()
  })

  /*
  test("routes V1 archive through the legacy session update", async () => {
    const { api, requests } = setup("v1")
    await api.session.archive({ sessionID: "ses_1", directory: "/repo" })

    const url = new URL(requests[0]!.url)
    expect(url.pathname).toBe("/session/ses_1")
    expect(requests[0]!.headers.get("x-opencode-directory")).toBe("%2Frepo")
    expect(requests[0]!.method).toBe("PATCH")
    expect(await requests[0]!.json()).toMatchObject({ time: { archived: expect.any(Number) } })
  })
  */

  test("converts current prompts to the V1 prompt contract", async () => {
    const { api, requests } = setup("v1")
    await api.session.prompt({
      sessionID: "ses_1",
      id: "msg_1",
      text: "hello @src/index.ts",
      agent: "build",
      model: { providerID: "provider", modelID: "model" },
      files: [
        { uri: "file:///repo/src/index.ts", name: "index.ts", mention: { text: "@src/index.ts", start: 6, end: 19 } },
        { uri: "data:text/plain;base64,aGVsbG8=", name: "notes.txt" },
      ],
    })

    expect(new URL(requests[0].url).pathname).toBe("/session/ses_1/prompt_async")
    const body = await requests[0].json()
    expect(body).toMatchObject({
      messageID: "msg_1",
      agent: "build",
      model: { providerID: "provider", modelID: "model" },
      parts: [
        { type: "text", text: "hello @src/index.ts" },
        {
          type: "file",
          mime: "text/plain",
          url: "file:///repo/src/index.ts",
          filename: "index.ts",
          source: {
            type: "file",
            text: { value: "@src/index.ts", start: 6, end: 19 },
            path: "file:///repo/src/index.ts",
          },
        },
        {
          type: "file",
          mime: "text/plain",
          url: "data:text/plain;base64,aGVsbG8=",
          filename: "notes.txt",
        },
      ],
    })
    expect(body.parts[2]).not.toHaveProperty("source")
  })

  test("preserves original parts for V1 optimistic reconciliation", async () => {
    const { api, requests } = setup("v1")
    await api.session.prompt({
      sessionID: "ses_1",
      id: "msg_1",
      text: "look",
      files: [{ uri: "data:image/png;base64,AAAA", name: "image.png" }],
      legacyParts: [
        { id: "prt_text", type: "text", text: "look" },
        { id: "prt_image", type: "file", mime: "image/png", url: "data:image/png;base64,AAAA", filename: "image.png" },
      ],
    })

    expect((await requests[0].json()).parts).toEqual([
      { id: "prt_text", type: "text", text: "look" },
      { id: "prt_image", type: "file", mime: "image/png", url: "data:image/png;base64,AAAA", filename: "image.png" },
    ])
  })

  test("resolves protocol detection once across implementation methods", async () => {
    let detections = 0
    const resolved = Promise.resolve<"v1" | "v2">("v2")
    const protocol = new Proxy(resolved, {
      get(target, property) {
        if (property !== "then") return Reflect.get(target, property, target)
        detections++
        return target.then.bind(target)
      },
    })
    const { api } = setup(protocol)

    await api.session.list()
    await api.session.list()

    expect(detections).toBe(1)
  })

  /*
  test("keeps V2 session actions on the current API", async () => {
    const { api, requests } = setup("v2")
    await api.session.archive({ sessionID: "ses_1" })

    expect(new URL(requests[0]!.url).pathname).toBe("/api/session/ses_1/archive")
    expect(requests[0]!.method).toBe("POST")
  })
  */

  test("uses the global V1 session search endpoint", async () => {
    const { api, requests } = setup("v1")
    await api.session.list({ parentID: null, search: "session", limit: 50 })

    expect(new URL(requests[0].url).pathname).toBe("/experimental/session")
  })

  test("loads Home sessions from each requested directory on V1", async () => {
    const { api, requests } = setup("v1")
    await api.session.list({ directories: ["/project", "/worktree", "/project"], roots: true, archived: false, sort: "updated", limit: 64 })
    expect(requests).toHaveLength(2)
    expect(requests.map((request) => {
      const url = new URL(request.url)
      expect(url.pathname).toBe("/experimental/session")
      expect(Object.fromEntries(url.searchParams)).toMatchObject({ roots: "true", archived: "false", limit: "64" })
      return url.searchParams.get("directory")
    })).toEqual(["/project", "/worktree"])
  })

  /*
  test("projects the V1 default branch", async () => {
    const { api } = setup("v1", { vcs: { branch: "feature", default_branch: "dev" } })

    expect(await api.vcs.get({ location: { directory: "/repo" } })).toMatchObject({
      data: { branch: "feature", defaultBranch: "dev" },
    })
  })
  */

  test("translates current file searches to the V1 dirs parameter", async () => {
    const { api, requests } = setup("v1")
    await api.file.find({ location: { directory: "/repo" }, query: "src", type: "file", limit: 20 })

    const url = new URL(requests[0].url)
    expect(url.pathname).toBe("/find/file")
    expect(url.searchParams.get("dirs")).toBe("false")
    expect(url.searchParams.get("limit")).toBe("20")
  })

  test("routes V1 permission replies through the requested directory", async () => {
    const { api, requests } = setup("v1")
    await api.permission.reply({
      sessionID: "ses_1",
      requestID: "permission_1",
      reply: "once",
      location: { directory: "/other" },
    })

    expect(new URL(requests[0].url).pathname).toBe("/session/ses_1/permissions/permission_1")
    expect(new URL(requests[0].url).searchParams.get("directory")).toBe("/other")
  })

  test("disposes the V1 instance after connecting a provider", async () => {
    const { api, requests } = setup("v1")

    await api.integration.connect.key({
      integrationID: "openrouter",
      key: "secret",
      location: { directory: "/repo" },
    })

    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/auth/openrouter",
      "/instance/dispose",
      "/instance/dispose",
    ])
    expect(requests[1].headers.get("x-opencode-directory")).toBe("%2Frepo")
    expect(requests[2].headers.get("x-opencode-directory")).toBeNull()
  })

  test("disposes the V1 instance after completing provider OAuth", async () => {
    const { api, requests } = setup("v1")

    await api.integration.oauth.complete({
      integrationID: "openrouter",
      attemptID: "openrouter:0",
      code: "code",
      location: { directory: "/repo" },
    })

    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/provider/openrouter/oauth/callback",
      "/instance/dispose",
      "/instance/dispose",
    ])
    expect(requests[1].headers.get("x-opencode-directory")).toBe("%2Frepo")
    expect(requests[2].headers.get("x-opencode-directory")).toBeNull()
  })
})
