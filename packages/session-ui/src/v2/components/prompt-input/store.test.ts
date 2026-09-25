import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import type { PromptInputV2PersistedState } from "./types"
import { createPromptInputV2Store } from "./store"

function createPromptStore() {
  return createPromptInputV2Store(
    createStore<PromptInputV2PersistedState>({
      prompt: [
        { type: "text", content: "old", start: 0, end: 3 },
        {
          type: "image",
          id: "attachment-1",
          filename: "notes.txt",
          mime: "text/plain",
          blob: { id: "a", url: "blob:a" },
        },
      ],
      cursor: 3,
      model: { providerID: "anthropic", modelID: "claude-sonnet", variant: null },
      context: { items: [] },
    }),
  )
}

describe("prompt input v2 store", () => {
  test("replaces a split slash query without losing surrounding text or mentions", () => {
    const prompt = createPromptStore()
    const attachment = prompt.state.prompt[1]!
    prompt.setPrompt([
      { type: "file", path: "one", content: "@one", start: 0, end: 4 },
      { type: "text", content: " explain /r", start: 4, end: 15 },
      { type: "text", content: "e afterwards ", start: 15, end: 28 },
      { type: "agent", name: "build", content: "@build", start: 28, end: 34 },
      attachment,
    ], 16)

    prompt.replaceText(13, 16, "/review ")

    expect(prompt.state.prompt).toEqual([
      { type: "file", path: "one", content: "@one", start: 0, end: 4 },
      { type: "text", content: " explain /review ", start: 4, end: 21 },
      { type: "text", content: " afterwards ", start: 21, end: 33 },
      { type: "agent", name: "build", content: "@build", start: 33, end: 39 },
      attachment,
    ])
    expect(prompt.state.cursor).toBe(21)
  })

  test("captures the originating store while retaining its latest draft", () => {
    const a = createStore<PromptInputV2PersistedState>({ prompt: [], cursor: 0, context: { items: [] } })
    const b = createStore<PromptInputV2PersistedState>({ prompt: [], cursor: 0, context: { items: [] } })
    let active = a
    const draft = createPromptInputV2Store(() => active)
    const target = draft.capture()
    draft.setText("edited during upload")
    active = b
    draft.setText("other chat")
    target.set([...target.current(), {
      type: "image", id: "attachment", filename: "notes.txt", mime: "text/plain",
      blob: { id: "blob", url: "blob:notes" },
    }], target.cursor())

    expect(a[0].prompt).toHaveLength(2)
    expect(a[0].prompt[0]).toMatchObject({ content: "edited during upload" })
    expect(b[0].prompt).toEqual([{ type: "text", content: "other chat", start: 0, end: 10 }])
    expect(a[0].cursor).toBe(20)
  })

  test("accepts an accessor for the backing store", () => {
    const [state, setState] = createStore<PromptInputV2PersistedState>({
      prompt: [{ type: "text", content: "", start: 0, end: 0 }],
      cursor: 0,
      context: { items: [] },
    })
    const prompt = createPromptInputV2Store([() => state, setState])

    prompt.setText("accessed")

    expect(prompt.state.prompt).toEqual([{ type: "text", content: "accessed", start: 0, end: 8 }])
    expect(prompt.state.cursor).toBe(8)
  })

  test("updates prompt text and cursor together while preserving attachments", () => {
    const prompt = createPromptStore()

    prompt.setText("updated")

    expect(prompt.state.prompt).toEqual([
      { type: "text", content: "updated", start: 0, end: 7 },
      {
        type: "image",
        id: "attachment-1",
        filename: "notes.txt",
        mime: "text/plain",
        blob: { id: "a", url: "blob:a" },
      },
    ])
    expect(prompt.state.cursor).toBe(7)
  })

  test("inserts text without flattening structured mentions", () => {
    const [state, setState] = createStore<PromptInputV2PersistedState>({
      prompt: [
        { type: "text", content: "A ", start: 0, end: 2 },
        { type: "file", path: "one", content: "@one", start: 2, end: 6 },
        { type: "text", content: " B", start: 6, end: 8 },
      ],
      cursor: 2,
      context: { items: [] },
    })
    const prompt = createPromptInputV2Store([state, setState])

    prompt.addText("X\nY")

    expect(prompt.state.prompt).toEqual([
      { type: "text", content: "A X\nY", start: 0, end: 5 },
      { type: "file", path: "one", content: "@one", start: 5, end: 9 },
      { type: "text", content: " B", start: 9, end: 11 },
    ])
    expect(prompt.state.cursor).toBe(5)
  })

  test("mutates context, attachments, and model through shared actions", () => {
    const prompt = createPromptStore()
    const context = { key: "file:src/index.ts", type: "file" as const, path: "src/index.ts" }

    prompt.addContext(context)
    prompt.addContext(context)
    prompt.addMention({ type: "file", path: "src/app.ts", content: "@src/app.ts", start: 0, end: 0 })
    prompt.removeAttachment("attachment-1")
    prompt.setVariant("thinking")

    expect(prompt.state.context.items).toEqual([context])
    expect(prompt.state.prompt).toEqual([
      { type: "text", content: "old", start: 0, end: 3 },
      { type: "file", path: "src/app.ts", content: "@src/app.ts", start: 3, end: 14 },
      { type: "text", content: " ", start: 14, end: 15 },
    ])
    expect(prompt.state.model?.variant).toBe("thinking")

    prompt.removeContext(context.key)
    prompt.setPrompt([{ type: "text", content: "old", start: 0, end: 3 }], 3)
    prompt.setModel(undefined)

    expect(prompt.state.context.items).toEqual([])
    expect(prompt.state.prompt).toEqual([{ type: "text", content: "old", start: 0, end: 3 }])
    expect(prompt.state.model).toBeUndefined()
  })

  test("resets the prompt and cursor", () => {
    const prompt = createPromptStore()

    prompt.reset()

    expect(prompt.state.prompt).toEqual([{ type: "text", content: "", start: 0, end: 0 }])
    expect(prompt.state.cursor).toBe(0)
  })
})
