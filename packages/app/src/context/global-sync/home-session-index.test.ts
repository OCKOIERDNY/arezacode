import { describe, expect, test } from "bun:test"
import { QueryClient } from "@tanstack/solid-query"
import type { Session } from "@opencode-ai/sdk/v2/client"
import {
  applyHomeSessionEvent,
  appendHomeSessionEvent,
  createHomeSessionIndexCache,
  HOME_SESSION_LIMIT,
  loadHomeSessionIndex,
  homeSessionIndexSessions,
  homeSessionIndexRefresh,
  parseHomeSessionIndex,
  selectHomeSessions,
  type HomeSessionIndex,
} from "./home-session-index"

const session = (input: {
  id: string
  directory?: string
  parentID?: string
  archived?: number
  updated?: number
}) => ({
  id: input.id,
  parentID: input.parentID,
  projectID: "project",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: input.updated ?? 1, archived: input.archived },
  title: input.id,
  location: { directory: input.directory ?? "/project" },
})

describe("Home V2 session index", () => {
  test("does not fetch when there are no visible project directories", async () => {
    let calls = 0
    const result = await loadHomeSessionIndex(async () => {
      calls++
      return { data: [], cursor: {} }
    }, { directories: [], limit: HOME_SESSION_LIMIT })
    expect(calls).toBe(0)
    expect(result.sessions).toEqual([])
  })

  test("bounds title and project-name search requests without loading older pages", async () => {
    const calls: unknown[] = []
    const result = await loadHomeSessionIndex(async (input) => {
      calls.push(input)
      return { data: [session({ id: "older matching chat", directory: "/docs", updated: 50 })], cursor: { next: "more" } }
    }, { directories: ["/project", "/docs"], matchingDirectories: ["/docs"], search: "docs", limit: 5000 })
    expect(result.sessions.map((item) => item.id)).toEqual(["older matching chat"])
    expect(calls).toEqual([
      { directories: ["/project", "/docs"], search: "docs", limit: 64, order: "desc", sort: "updated", roots: true, archived: false },
      { directories: ["/docs"], limit: 64, order: "desc", sort: "updated", roots: true, archived: false },
    ])
  })

  test("retains events for overlapping project fetches and rebases inactive scopes", () => {
    const client = new QueryClient()
    const cache = createHomeSessionIndexCache(client, "server")
    const query = { directories: ["/project"], limit: 2 }
    const key = [...cache.indexKey, query]
    const initial = { sessions: parseHomeSessionIndex([session({ id: "root" })]), eventSequence: 0, query }
    client.setQueryData(key, initial)
    const slow = cache.begin()
    cache.apply({ type: "session.updated", properties: {
      sessionID: "root", info: { ...initial.sessions[0], title: "updated during fetch" },
    } })
    const fast = cache.begin()
    cache.complete(fast)
    cache.complete(slow)
    expect(cache.sessions(initial, client.getQueryData(cache.eventsKey))[0].title).toBe("updated during fetch")
    const next = cache.begin()
    cache.complete(next)
    expect(client.getQueryData<HomeSessionIndex>(key)?.sessions[0].title).toBe("updated during fetch")
  })

  test("live events stay bounded and cannot leak across project or search scopes", () => {
    const client = new QueryClient()
    const cache = createHomeSessionIndexCache(client, "server")
    const project = { directories: ["/project"], limit: 2 }
    const search = { directories: ["/other"], limit: 2, search: "needle" }
    const key = [...cache.indexKey, project]
    const searchKey = [...cache.indexKey, search]
    client.setQueryData(key, { sessions: [], eventSequence: 0, query: project })
    client.setQueryData(searchKey, { sessions: [], eventSequence: 0, query: search })
    for (let index = 0; index < 80; index++) {
      const info = parseHomeSessionIndex([session({ id: `chat-${index}`, updated: index })])[0]
      cache.apply({ type: "session.created", properties: { sessionID: info.id, info } })
    }
    expect(client.getQueryData<HomeSessionIndex>(key)?.sessions.map((item) => item.id)).toEqual(["chat-79", "chat-78"])
    expect(client.getQueryData<HomeSessionIndex>(searchKey)?.sessions).toEqual([])
  })

  test("loads the Home index with one global V2 request", async () => {
    const calls: unknown[] = []
    const result = await loadHomeSessionIndex(async (input) => {
      calls.push(input)
      return { data: [session({ id: "root" })], cursor: {} }
    }, { directories: ["/project"], limit: HOME_SESSION_LIMIT })

    expect(result.sessions).toHaveLength(1)
    expect(calls).toEqual([{
      directories: ["/project"], limit: HOME_SESSION_LIMIT, order: "desc", sort: "updated", roots: true, archived: false,
    }])
  })

  test("never drains history even when the bounded page has a next cursor", async () => {
    const calls: unknown[] = []
    const controller = new AbortController()
    const result = await loadHomeSessionIndex(
      async (input, options) => {
        calls.push({ input, signal: options?.signal })
        return {
          data: Array.from({ length: HOME_SESSION_LIMIT }, (_, index) => session({ id: `session-${index}` })),
          cursor: { next: "next-page" },
        }
      },
      { directories: ["/project"], limit: HOME_SESSION_LIMIT },
      0,
      controller.signal,
    )

    expect(result.sessions).toHaveLength(HOME_SESSION_LIMIT)
    expect(calls).toEqual([
      {
        input: { directories: ["/project"], limit: HOME_SESSION_LIMIT, order: "desc", sort: "updated", roots: true, archived: false },
        signal: controller.signal,
      },
    ])
  })

  test("maps visible roots to Home session summaries", () => {
    const activeNull = {
      ...session({ id: "active-null", updated: 20 }),
      time: { created: 1, updated: 20, archived: null },
    }
    const result = parseHomeSessionIndex([
      session({ id: "root", updated: 30 }),
      activeNull,
      session({ id: "child", parentID: "root", updated: 40 }),
      session({ id: "archived", archived: 50, updated: 50 }),
    ])

    expect(result).toEqual([
      expect.objectContaining({
        id: "root",
        slug: "root",
        version: "",
        directory: "/project",
        projectID: "project",
        title: "root",
        time: { created: 1, updated: 30 },
      }),
      expect.objectContaining({
        id: "active-null",
        time: { created: 1, updated: 20, archived: undefined },
      }),
    ])
  })

  test("bounds retained rows globally and isolates selected project directories", () => {
    const sessions = Array.from({ length: 80 }, (_, index) => ({
      ...parseHomeSessionIndex([session({ id: `session-${index}`, updated: index + 1 })])[0],
      directory: index % 2 === 0 ? "/one" : "/two",
    }))

    const retained = selectHomeSessions(sessions, { directories: ["/one"], limit: 10 })
    expect(retained).toHaveLength(10)
    expect(retained.every((item) => item.directory === "/one")).toBe(true)
    expect(selectHomeSessions(sessions)).toHaveLength(HOME_SESSION_LIMIT)
  })

  test("replays session events over the loaded index", () => {
    const initial = parseHomeSessionIndex([session({ id: "old" })])
    const created = { ...initial[0], id: "new", slug: "new", title: "new", time: { created: 2, updated: 2 } }

    const afterCreate = applyHomeSessionEvent(initial, {
      type: "session.created",
      properties: { sessionID: created.id, info: created },
    })
    expect(
      applyHomeSessionEvent(afterCreate, {
        type: "session.deleted",
        properties: { sessionID: initial[0].id, info: initial[0] },
      }),
    ).toEqual([created])
  })

  test("applies only events newer than the index baseline", () => {
    const initial = parseHomeSessionIndex([session({ id: "old" })])
    const stale = { ...initial[0], title: "stale" }
    const current = { ...initial[0], title: "current" }
    const first = appendHomeSessionEvent(undefined, {
      type: "session.updated",
      properties: { sessionID: stale.id, info: stale },
    })
    const events = appendHomeSessionEvent(first, {
      type: "session.updated",
      properties: { sessionID: current.id, info: current },
    })

    expect(homeSessionIndexSessions({ sessions: initial, eventSequence: 1 }, events)[0]?.title).toBe("current")
  })

  test("refetches after reconnect, disposal, and session moves", () => {
    expect(homeSessionIndexRefresh("server.connected", false)).toEqual({ connected: true, refetch: false })
    expect(homeSessionIndexRefresh("server.connected", true)).toEqual({ connected: true, refetch: true })
    expect(homeSessionIndexRefresh("global.disposed", true).refetch).toBe(true)
    expect(homeSessionIndexRefresh("session.next.moved", true).refetch).toBe(true)
  })

  test("removes a session from the loaded Home index", () => {
    const queryClient = new QueryClient()
    const cache = createHomeSessionIndexCache(queryClient, "server")
    const sessions = parseHomeSessionIndex([session({ id: "a" }), session({ id: "b" })])
    queryClient.setQueryData(cache.indexKey, { sessions, eventSequence: 0 })

    cache.remove("a")

    const index = queryClient.getQueryData<{ sessions: Session[] }>(cache.indexKey)
    expect(index?.sessions.map((item) => item.id)).toEqual(["b"])
  })

  test("keeps the session out of the Home list when the index is not mounted", () => {
    const queryClient = new QueryClient()
    const cache = createHomeSessionIndexCache(queryClient, "server")
    const sessions = parseHomeSessionIndex([session({ id: "a" }), session({ id: "b" })])

    cache.remove("a")

    expect(queryClient.getQueryData(cache.indexKey)).toBeUndefined()
    expect(cache.sessions({ sessions, eventSequence: 0 }, undefined).map((item) => item.id)).toEqual(["b"])
  })
})
