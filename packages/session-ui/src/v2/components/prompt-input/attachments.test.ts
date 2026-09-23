import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createPromptInputV2Attachments } from "./attachments"
import { createPromptInputV2Store } from "./store"
import type { PromptInputV2PersistedState } from "./types"

for (const mode of ["upload", "native-picker", "file-input"] as const) {
  test(`keeps ${mode} attachments in the originating chat`, async () => {
    const a = createStore<PromptInputV2PersistedState>({ prompt: [], cursor: 0, context: { items: [] } })
    const b = createStore<PromptInputV2PersistedState>({ prompt: [], cursor: 0, context: { items: [] } })
    let active = a
    const draft = createPromptInputV2Store(() => active)
    const upload = Promise.withResolvers<{ id: string; url: string }>()
    const selected = Promise.withResolvers<File>()
    const complete = Promise.withResolvers<unknown>()
    const file = new File(["notes"], "notes.txt", { type: "text/plain" })
    const scope = createRoot((dispose) => ({
      dispose,
      attachments: createPromptInputV2Attachments({
        capture: draft.capture,
        editor: () => ({} as HTMLElement),
        focusEditor() {},
        addPart: () => false,
        setDraggingType() {},
        directory: () => "/repo",
        isDialogActive: () => false,
        warn() { throw new Error("Unexpected warning") },
        duplicate() { throw new Error("Unexpected duplicate") },
        onError: complete.reject,
        store: () => upload.promise,
        picker: mode === "native-picker" ? async (_, onFile) => {
          complete.resolve(await onFile(await selected.promise))
        } : undefined,
      }),
    }))
    try {
      const pending = mode === "upload" ? scope.attachments.addAttachments([file]) : undefined
      if (mode !== "upload") scope.attachments.pick(() => {})
      draft.setText("new draft text")
      active = b
      draft.setText("chat B")
      const picked = mode === "file-input" ? scope.attachments.addPickedAttachments([file]) : undefined
      selected.resolve(file)
      upload.resolve({ id: "blob", url: "blob:notes" })
      await (mode === "native-picker" ? complete.promise : pending ?? picked)
      expect(a[0].prompt).toHaveLength(2)
      expect(a[0].prompt[0]).toMatchObject({ content: "new draft text" })
      expect(a[0].prompt[1]).toMatchObject({ type: "image", filename: "notes.txt" })
      expect(b[0].prompt).toEqual([{ type: "text", content: "chat B", start: 0, end: 6 }])
    } finally {
      scope.dispose()
    }
  })
}
