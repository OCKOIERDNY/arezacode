import { expect, test } from "bun:test"
import { loadContextUsage, type ContextUsageEntry } from "./session-context-data"
import { modelUsage, usageCacheRate, usageTotal } from "./session-context-metrics"

const entry = (
  id: string,
  role: ContextUsageEntry["role"] = "main",
  kind: ContextUsageEntry["kind"] = "model",
): ContextUsageEntry => ({
  id,
  role,
  kind,
  sessionID: "root",
  model: { providerID: "provider", id: "model", variant: "low" },
  time: { created: 1 },
  usage: { version: 1, input: 100, output: 20, total: 120, cacheRead: 50, costSource: "unknown" },
})

test("loads every descendant page and deduplicates child references without loading transcripts", async () => {
  const reads: string[] = []
  const info = (id: string) => ({
    id,
    projectID: "project",
    agent: "explore",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    title: id,
    location: { directory: "/repo" },
  })
  const loaded = await loadContextUsage({
    sessionID: "root",
    usage: async (sessionID) => {
      reads.push(sessionID)
      return [entry(`msg_${sessionID}`)]
    },
    session: {
      list: async (input) => {
        if (input?.parentID === "root" && !input.cursor) return { data: [info("child-a")], cursor: { next: "second" } }
        if (input?.parentID === "root") return { data: [info("child-b")], cursor: {} }
        if (input?.parentID === "child-a") return { data: [info("grandchild"), info("child-b")], cursor: {} }
        return { data: [], cursor: {} }
      },
    },
  })
  expect(reads).toEqual(["root", "child-a", "child-b", "grandchild"])
  expect(loaded.map((item) => item.role)).toEqual(["main", "subagent", "subagent", "subagent"])
  expect(usageTotal(loaded, "input")).toEqual({ value: 400, missing: 0 })
})

test("separates routing from execution and combines model share across roles", () => {
  const groups = modelUsage([
    entry("a"),
    entry("b", "subagent"),
    entry("c", "main", "compaction"),
    entry("d", "main", "jev"),
    entry("e", "main", "automation"),
  ])
  expect(groups).toHaveLength(2)
  expect(groups[0]).toMatchObject({
    role: "main",
    modelCalls: 3,
    modelShare: 100,
    efforts: [{ effort: "low", count: 2 }],
  })
  expect(groups.reduce((sum, group) => sum + group.share, 0)).toBeCloseTo(100)
  expect(usageTotal([entry("a")], "cost")).toEqual({ value: undefined, missing: 1 })
})

test("cache rate only combines known input and cache-read pairs", () => {
  expect(
    usageCacheRate([
      entry("known"),
      { usage: { version: 1, input: 1000, costSource: "unknown" } },
      { usage: { version: 1, input: 10, cacheRead: 20, costSource: "unknown" } },
    ]),
  ).toEqual({ value: 50, missing: 2 })
  expect(usageCacheRate([])).toEqual({ value: undefined, missing: 0 })
})

test("does not present incomplete descendant loading as complete totals", async () => {
  await expect(
    loadContextUsage({
      sessionID: "root",
      usage: async () => [entry("a")],
      session: {
        list: async () => {
          throw new Error("offline")
        },
      },
    }),
  ).rejects.toThrow("offline")
})
