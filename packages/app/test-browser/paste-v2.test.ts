import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createPromptInputV2Controller } from "@opencode-ai/session-ui/v2/prompt-input/interaction"
import type { PromptInputV2PersistedState } from "@opencode-ai/session-ui/v2/prompt-input/types"

test("large and multiline pastes preserve text and selection without native rich-text insertion", () => {
  createRoot((dispose) => {
    const store = createStore<PromptInputV2PersistedState>({
      prompt: [], cursor: 0, context: { items: [] },
    })
    const controller = createPromptInputV2Controller({
      store,
      commands: () => [], context: () => [], searchContextFiles: () => [],
      view: { submit: { stopping: () => false, onSubmit() {}, onStop() {} } },
    })
    const descriptor = Object.getOwnPropertyDescriptor(document, "execCommand")
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value() { throw new Error("Large paste must bypass native rich-text insertion") },
    })
    const editor = document.createElement("div")
    document.body.append(editor)
    try {
      for (const text of ["line of pasted text\n".repeat(10000), "x".repeat(200000), "a\r\nb\rc"]) {
        editor.textContent = "before replace after"
        const range = document.createRange()
        range.setStart(editor.firstChild!, 7)
        range.setEnd(editor.firstChild!, 14)
        const selection = window.getSelection()!
        selection.removeAllRanges()
        selection.addRange(range)
        let updates = 0
        editor.oninput = () => { updates += 1 }
        const clipboardData = new DataTransfer()
        clipboardData.setData("text/plain", text)
        editor.onpaste = controller.onPaste
        const event = new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true })
        editor.dispatchEvent(event)
        const normalized = text.replace(/\r\n?/g, "\n")
        expect(event.defaultPrevented).toBe(true)
        expect(editor.textContent).toBe(`before ${normalized} after`)
        expect(editor.childNodes.length).toBeLessThanOrEqual(3)
        expect(updates).toBe(1)
        expect(selection.isCollapsed).toBe(true)
        selection.getRangeAt(0).insertNode(document.createTextNode("!"))
        expect(editor.textContent).toBe(`before ${normalized}! after`)
      }
    } finally {
      editor.remove()
      if (descriptor) Object.defineProperty(document, "execCommand", descriptor)
      if (!descriptor) Reflect.deleteProperty(document, "execCommand")
      dispose()
    }
  })
})
