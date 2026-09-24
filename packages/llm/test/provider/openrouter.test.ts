import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { CacheHint, LLM, Message, ToolResultPart } from "../../src"
import { LLMClient } from "../../src/route"
import * as OpenRouter from "../../src/providers/openrouter"
import { it } from "../lib/effect"

describe("OpenRouter", () => {
  it.effect("keeps cache hints on their source messages around synthetic vision and system updates", () => Effect.gen(function* () {
    const cache = new CacheHint({ type: "ephemeral" })
    const prepared = yield* LLMClient.prepare(LLM.request({
      model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4"),
      cache: {},
      messages: [
        Message.user([{ type: "text", text: "Task", cache }]),
        Message.system("New constraint"),
        Message.tool({ id: "image", name: "read", result: { type: "content", value: [
          { type: "text", text: "Screenshot" },
          { type: "file", mime: "image/png", uri: "data:image/png;base64,aGVsbG8=" },
        ] }, cache }),
        Message.user("Continue"),
      ],
    }))
    expect(prepared.body).toMatchObject({ messages: [
      { role: "user", content: [{ text: "Task", cache_control: { type: "ephemeral" } }] },
      { role: "user", content: expect.stringContaining("<system-update>") },
      { role: "tool", tool_call_id: "image", content: [{ text: "Screenshot", cache_control: { type: "ephemeral" } }] },
      { role: "user", content: [{ type: "image_url" }] },
      { role: "user", content: "Continue" },
    ] })
  }))

  it.effect("applies automatic cache policies to multipart users and assistant tails", () => Effect.gen(function* () {
    const model = OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4")
    const messages = [
      Message.user([{ type: "media", mediaType: "image/png", data: "data:image/png;base64,aGVsbG8=" }, { type: "text", text: "Task" }]),
      Message.assistant("Answer"),
    ]
    const user = yield* LLMClient.prepare(LLM.request({ model, messages }))
    expect(user.body).toMatchObject({ messages: [
      { role: "user", content: [{ type: "image_url" }, { text: "Task", cache_control: { type: "ephemeral" } }] },
      { role: "assistant", content: "Answer" },
    ] })
    const assistant = yield* LLMClient.prepare(LLM.request({ model, messages, cache: { messages: "latest-assistant" } }))
    expect(assistant.body).toMatchObject({ messages: [
      { role: "user" },
      { role: "assistant", content: [{ text: "Answer", cache_control: { type: "ephemeral" } }] },
    ] })
    const disabled = yield* LLMClient.prepare(LLM.request({ model, messages, cache: "none" }))
    expect(JSON.stringify(disabled.body)).not.toContain("cache_control")
  }))

  it.effect("preserves multimodal, assistant, and individual tool-result cache boundaries", () => Effect.gen(function* () {
    const cache = new CacheHint({ type: "ephemeral", ttlSeconds: 3600 })
    const prepared = yield* LLMClient.prepare(LLM.request({
      model: OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4"),
      cache: {},
      messages: [
        Message.user([{ type: "text", text: "Look", cache }, { type: "media", mediaType: "image/png", data: "data:image/png;base64,aGVsbG8=" }]),
        Message.assistant([{ type: "text", text: "First", cache }, { type: "text", text: "Second" }]),
        Message.make({ role: "tool", content: [
          ToolResultPart.make({ id: "call_a", name: "read", result: { type: "text", value: "A" }, cache }),
          ToolResultPart.make({ id: "call_b", name: "read", result: { type: "text", value: "B" } }),
        ] }),
      ],
    }))
    expect(prepared.body).toMatchObject({ messages: [
      { role: "user", content: [{ text: "Look", cache_control: { type: "ephemeral", ttl: "1h" } }, { type: "image_url" }] },
      { role: "assistant", content: [{ text: "First", cache_control: { type: "ephemeral", ttl: "1h" } }, { text: "\nSecond" }] },
      { role: "tool", tool_call_id: "call_a", content: [{ text: "A", cache_control: { type: "ephemeral", ttl: "1h" } }] },
      { role: "tool", tool_call_id: "call_b", content: "B" },
    ] })
  }))
  it.effect("adds Claude cache breakpoints and respects cache none", () => Effect.gen(function* () {
    const model = OpenRouter.configure({ apiKey: "test-key" }).model("anthropic/claude-sonnet-4")
    const prepared = yield* LLMClient.prepare(LLM.request({ model, system: "Stable instructions", prompt: "Task" }))
    expect(prepared.body).toMatchObject({ messages: [{ role: "system", content: [{ text: "Stable instructions", cache_control: { type: "ephemeral" } }] }, { role: "user", content: [{ text: "Task", cache_control: { type: "ephemeral" } }] }] })
    const disabled = yield* LLMClient.prepare(LLM.request({ model, system: "Stable instructions", prompt: "Task", cache: "none" }))
    expect(JSON.stringify(disabled.body)).not.toContain("cache_control")
  }))
  it.effect("prepares OpenRouter models through the OpenAI-compatible Chat route", () =>
    Effect.gen(function* () {
      const model = OpenRouter.configure({ apiKey: "test-key" }).model("openai/gpt-4o-mini")

      expect(model).toMatchObject({
        id: "openai/gpt-4o-mini",
        provider: "openrouter",
        route: { id: "openrouter" },
      })
      expect(model.route.endpoint.baseURL).toBe("https://openrouter.ai/api/v1")

      const prepared = yield* LLMClient.prepare(LLM.request({ model, prompt: "Say hello." }))

      expect(prepared.route).toBe("openrouter")
      expect(prepared.body).toMatchObject({
        model: "openai/gpt-4o-mini",
        messages: [{ role: "user", content: "Say hello." }],
        stream: true,
      })
    }),
  )

  it.effect("applies OpenRouter payload options from the model helper", () =>
    Effect.gen(function* () {
      const prepared = yield* LLMClient.prepare(
        LLM.request({
          model: OpenRouter.configure({
            apiKey: "test-key",
            providerOptions: {
              openrouter: {
                usage: true,
                reasoning: { effort: "high" },
                promptCacheKey: "session_123",
              },
            },
          }).model("anthropic/claude-3.7-sonnet:thinking"),
          prompt: "Think briefly.",
        }),
      )

      expect(prepared.body).toMatchObject({
        usage: { include: true },
        reasoning: { effort: "high" },
        prompt_cache_key: "session_123",
      })
    }),
  )
})
