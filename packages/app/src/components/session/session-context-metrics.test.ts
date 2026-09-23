import { describe, expect, test } from "bun:test"
import type { AssistantMessage, Message } from "@opencode-ai/sdk/v2/client"
import { executionTiming, getSessionContext, getSessionCost, recordedUsage, responsePerformance, usageTotal } from "./session-context-metrics"

test("execution timing separates overlapping work, checks, question waits and unmeasured time", () => {
  const timing = executionTiming(0, 100, [
    { kind: "routing", start: -10, end: 10 },
    { kind: "model", start: 20, end: 120 },
    { kind: "tools", start: 30, end: 70 },
    { kind: "tools", start: 40, end: 60 },
    { kind: "checks", start: 50, end: 60 },
    { kind: "wait", start: 60, end: 80 },
    { kind: "checks", start: 90, end: 85 },
  ])
  expect(timing).toEqual({ routing: 10, model: 30, tools: 20, checks: 10, wait: 20, other: 10 })
  expect(Object.values(timing).reduce((sum, value) => sum + value, 0)).toBe(100)
  expect(executionTiming(10, 20, [])).toEqual({ routing: 0, model: 0, tools: 0, checks: 0, wait: 0, other: 10 })
  expect(executionTiming(10, 10, [{ kind: "model", start: 0, end: 20 }]).model).toBe(0)
})

const assistant = (
  id: string,
  tokens: { input: number; output: number; reasoning: number; read: number; write: number },
  cost: number,
  providerID = "openai",
  modelID = "gpt-4.1",
) => {
  return {
    id,
    role: "assistant",
    providerID,
    modelID,
    cost,
    tokens: {
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning,
      cache: {
        read: tokens.read,
        write: tokens.write,
      },
    },
    time: { created: 1 },
  } as unknown as AssistantMessage
}

const user = (id: string) => {
  return {
    id,
    role: "user",
    cost: 0,
    time: { created: 1 },
  } as unknown as Message
}

test("response performance excludes incomplete calls and separates checks, tools and user waits", () => {
  const messages = Array.from({ length: 10 }, (_, index) => ({
    ...assistant(`response-${index}`, { input: 0, output: 0, reasoning: 0, read: 0, write: 0 }, 0),
    time: { created: 0, completed: (index + 1) * 1000 },
  }))
  const result = responsePerformance([
    ...messages,
    assistant("incomplete", { input: 0, output: 0, reasoning: 0, read: 0, write: 0 }, 0),
  ], {
    "response-9": [
      { tool: "bash", start: 1000, end: 7000 },
      { tool: "project_check", start: 5000, end: 6000 },
      { tool: "question", start: 6000, end: 8000 },
    ].map((item) => ({
      id: item.tool, sessionID: "session", messageID: "response-9", callID: item.tool, type: "tool",
      tool: item.tool,
      state: { status: "completed", input: {}, output: "", title: "", metadata: {}, time: { start: item.start, end: item.end } },
    })),
  })
  expect(result).toMatchObject({ last: 10_000, recent: 8000, previous: 3000, tools: 4000, checks: 1000, wait: 2000, other: 3000, model: 0 })
  expect(responsePerformance([], {})).toBeUndefined()
})

describe("getSessionContext", () => {
  test("shows the detailed breakdown stored in legacy token fields", () => {
    const message = assistant("legacy", { input: 300, output: 100, reasoning: 20, read: 600, write: 100 }, 0.02)
    const usage = recordedUsage(message)
    expect(usage).toMatchObject({
      input: 1000,
      output: 120,
      reasoning: 20,
      cacheRead: 600,
      cacheWrite: 100,
      total: 1120,
      cost: 0.02,
      costSource: "unknown",
    })
    expect(usageTotal([{ usage }], "uncachedInput")).toEqual({ value: 400, missing: 0 })
    expect(getSessionContext([message])?.total).toBe(1120)
  })

  test("does not treat legacy placeholder zeros as recorded free usage", () => {
    const message = assistant("pending", { input: 0, output: 0, reasoning: 0, read: 0, write: 0 }, 0)
    expect(recordedUsage(message)).toBeUndefined()
    const used = assistant("used", { input: 100, output: 10, reasoning: 0, read: 0, write: 0 }, 0)
    expect(recordedUsage(used)?.input).toBe(100)
    expect(recordedUsage(used)?.cacheRead).toBe(0)
    expect(recordedUsage(used)?.cost).toBeUndefined()
  })

  test("preserves modern inclusive usage and explicitly reported zero cost", () => {
    const usage = { version: 1 as const, input: 1000, output: 120, total: 1120, cacheRead: 600, reasoning: 20, cost: 0, costSource: "reported" as const }
    const message = {
      ...assistant("modern", { input: 300, output: 100, reasoning: 20, read: 600, write: 100 }, 0.02),
      usage,
    }
    expect(recordedUsage(message)).toEqual(usage)
    expect(recordedUsage(message)?.cacheWrite).toBeUndefined()
    expect(getSessionContext([message])?.total).toBe(1120)
    expect(getSessionCost([message], 0)).toBe(0)
  })

  test("uses known message costs when the session aggregate is missing or still zero", () => {
    const messages = [
      assistant("a1", { input: 100, output: 10, reasoning: 0, read: 0, write: 0 }, 0.002),
      assistant("a2", { input: 200, output: 20, reasoning: 0, read: 0, write: 0 }, 0.004),
    ]
    expect(getSessionCost(messages)).toBeCloseTo(0.006)
    expect(getSessionCost(messages, 0)).toBeCloseTo(0.006)
    expect(getSessionCost(messages, 0.5)).toBe(0.5)
    expect(getSessionCost([], 0)).toBeUndefined()
  })

  test("sums inclusive usage once and keeps missing and zero-price data distinct", () => {
    const entries = [{ usage: { version: 1 as const, input: 1000, output: 120, total: 1120, cacheRead: 600, cacheWrite: 100, reasoning: 20, cost: 0, costSource: "reported" as const } }, { usage: { version: 1 as const, costSource: "unknown" as const } }]
    expect(usageTotal(entries, "total")).toEqual({ value: 1120, missing: 1 })
    expect(usageTotal(entries, "input")).toEqual({ value: 1000, missing: 1 })
    expect(usageTotal(entries, "uncachedInput")).toEqual({ value: 400, missing: 1 })
    expect(usageTotal([{ usage: { ...entries[0]!.usage, cacheRead: undefined } }], "uncachedInput")).toEqual({ value: undefined, missing: 1 })
    expect(usageTotal([{ usage: { ...entries[0]!.usage, cacheRead: 1000 } }], "uncachedInput")).toEqual({ value: 0, missing: 0 })
    expect(usageTotal([{ usage: { ...entries[0]!.usage, cacheRead: 1001 } }], "uncachedInput")).toEqual({ value: undefined, missing: 1 })
    expect(usageTotal(entries, "cost", "reported")).toEqual({ value: 0, missing: 1 })
    expect(usageTotal(entries, "cost", "estimated")).toEqual({ value: undefined, missing: 2 })
  })
  test("computes token totals and usage from latest assistant with tokens", () => {
    const messages = [
      user("u1"),
      assistant("a1", { input: 600, output: 200, reasoning: 100, read: 50, write: 50 }, 0.5),
      assistant("a2", { input: 300, output: 100, reasoning: 50, read: 25, write: 25 }, 1.25),
    ]
    const providers = [
      {
        id: "openai",
        name: "OpenAI",
        models: {
          "gpt-4.1": {
            name: "GPT-4.1",
            limit: { context: 1000 },
          },
        },
      },
    ]

    const ctx = getSessionContext(messages, providers)

    expect(ctx?.message.id).toBe("a2")
    expect(ctx?.total).toBe(500)
    expect(ctx?.input).toBe(350)
    expect(ctx?.usage).toBe(50)
    expect(ctx?.providerLabel).toBe("OpenAI")
    expect(ctx?.modelLabel).toBe("GPT-4.1")
  })

  test("preserves fallback labels and null usage when model metadata is missing", () => {
    const messages = [assistant("a1", { input: 40, output: 10, reasoning: 0, read: 0, write: 0 }, 0.1, "p-1", "m-1")]
    const providers = [{ id: "p-1", models: {} }]

    const ctx = getSessionContext(messages, providers)

    expect(ctx?.providerLabel).toBe("p-1")
    expect(ctx?.modelLabel).toBe("m-1")
    expect(ctx?.limit).toBeUndefined()
    expect(ctx?.usage).toBeNull()
  })

  test("recomputes when message array is mutated in place", () => {
    const messages = [assistant("a1", { input: 10, output: 10, reasoning: 10, read: 10, write: 10 }, 0.25)]
    const providers = [{ id: "openai", models: {} }]

    const one = getSessionContext(messages, providers)
    messages.push(assistant("a2", { input: 100, output: 20, reasoning: 0, read: 0, write: 0 }, 0.75))
    const two = getSessionContext(messages, providers)

    expect(one?.message.id).toBe("a1")
    expect(two?.message.id).toBe("a2")
  })

  test("returns undefined when inputs are undefined", () => {
    const ctx = getSessionContext(undefined, undefined)

    expect(ctx).toBeUndefined()
  })
})
