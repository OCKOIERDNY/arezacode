import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createPromptState, DEFAULT_PROMPT, hasPromptContent } from "./prompt-state"

test("empty drafts exclude whitespace but preserve text and attached context", () => {
  const empty = { prompt: DEFAULT_PROMPT, context: { items: [] } }
  expect(hasPromptContent(empty)).toBe(false)
  expect(hasPromptContent({ ...empty, prompt: [{ type: "text", content: "  ", start: 0, end: 2 }] })).toBe(false)
  expect(hasPromptContent({ ...empty, prompt: [{ type: "text", content: "Keep me", start: 0, end: 7 }] })).toBe(true)
  expect(
    hasPromptContent({ ...empty, prompt: [{ type: "file", path: "file.ts", content: "", start: 0, end: 0 }] }),
  ).toBe(true)
  expect(hasPromptContent({ ...empty, context: { items: [{ type: "file", path: "file.ts", key: "file.ts" }] } })).toBe(
    true,
  )
})

describe("prompt state initialization", () => {
  test("initializes prompt text, cursor, and model together", () => {
    createRoot((dispose) => {
      const model = { providerID: "anthropic", modelID: "claude", variant: "high" }
      const prompt = createPromptState({ prompt: "hello", model })

      expect(prompt.current()).toEqual([{ type: "text", content: "hello", start: 0, end: 5 }])
      expect(prompt.cursor()).toBe(5)
      expect(prompt.model.current()).toEqual(model)
      expect(prompt.model.current()).not.toBe(model)
      dispose()
    })
  })

  test("uses the default prompt without initial values", () => {
    createRoot((dispose) => {
      const prompt = createPromptState()

      expect(prompt.current()).toEqual(DEFAULT_PROMPT)
      expect(prompt.cursor()).toBeUndefined()
      expect(prompt.model.current()).toBeUndefined()
      dispose()
    })
  })
})
