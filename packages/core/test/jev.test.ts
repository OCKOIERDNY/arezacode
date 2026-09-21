import { expect, test } from "bun:test"
import { Jev } from "../src/jev"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const questions = {
  model: {
    type: "choice" as const,
    instructions: "Choose the suitable model",
    criteria: { fast: "Fast", strong: "Strong" },
  },
  skill: { type: "score" as const, instructions: "Skill relevance", criteria: ["No", "Maybe", "Yes"] },
}

test("Jev preserves manual choices, confines Auto, protects keys and honors disable", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "areza-jev-test-"))
  try {
    const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixtures/jev-flow.ts")], {
      env: {
        ...process.env,
        XDG_CONFIG_HOME: directory,
        XDG_DATA_HOME: directory,
        XDG_CACHE_HOME: directory,
        XDG_STATE_HOME: directory,
        OPENROUTER_API_KEY: "",
        OPENCODE_AUTH_CONTENT: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const error = await new Response(child.stderr).text()
    expect(await child.exited, error).toBe(0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)

test("Jev sends one bounded typed request and rejects invalid, failed, or incomplete answers", async () => {
  const requests: Array<{ state: unknown; model: string; questions: unknown }> = []
  let response: unknown = {
    answers: {
      model: { type: "choice", choice: "fast", confidence: 0.9 },
      skill: { type: "score", score: 2, confidence: 0.95 },
    },
  }
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push((await request.json()) as { state: unknown; model: string; questions: unknown })
      expect(request.headers.get("authorization")).toBe("Bearer test-only-not-a-real-key")
      return Response.json(response)
    },
  })
  const transport: typeof fetch = Object.assign(
    (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      expect(String(url)).toBe("https://openrouter.ai/api/alpha/decisions")
      expect(init?.redirect).toBe("error")
      return fetch(server.url, init)
    },
    { preconnect: fetch.preconnect },
  )
  try {
    const sessionID = `ses_usage_${crypto.randomUUID()}`
    response = { ...response as object, usage: { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35, cost: 0 } }
    const result = await Jev.request("test-only-not-a-real-key", { task: "Fix the typo" }, questions, transport, sessionID)
    expect(result?.model).toEqual({ type: "choice", choice: "fast", confidence: 0.9 })
    expect(requests).toHaveLength(1)
    expect(await Jev.usage(sessionID)).toMatchObject([{ kind: "jev", usage: { input: 30, output: 5, total: 35, cost: 0, costSource: "reported" } }])
    expect(requests[0].model).toBe("~typesafe/jev-latest")
    expect(Object.keys(requests[0].questions as object)).toEqual(["model", "skill"])
    response = {
      answers: {
        model: { type: "choice", choice: "unknown", confidence: 0.99 },
        skill: { type: "score", score: 2, confidence: 1 },
      },
    }
    expect(await Jev.request("test-only-not-a-real-key", {}, questions, transport)).toBeUndefined()
    response = { answers: { model: { type: "choice", choice: "fast", confidence: 1 } } }
    expect(await Jev.request("test-only-not-a-real-key", {}, questions, transport)).toBeUndefined()
    expect(await Jev.request("", {}, questions, transport)).toBeUndefined()
    expect(await Jev.request("test-only-not-a-real-key", "x".repeat(50_000), questions, transport)).toBeUndefined()
    expect(requests).toHaveLength(3)
    response = { answers: { model: { type: "choice", choice: "fast" }, skill: { type: "score", score: 2 } } }
    expect((await Jev.request("test-only-not-a-real-key", {}, questions, transport))?.model.confidence).toBe(0)
  } finally {
    server.stop(true)
  }
})
