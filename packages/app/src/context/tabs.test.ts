import { describe, expect, test } from "bun:test"
import { createRoot, getOwner, onCleanup } from "solid-js"
import { createTabMemory } from "./tab-memory"
import {
  nextTabAfterClose,
  pushClosedTab,
  removeClosedTabs,
  removeSessionTabs,
  takeClosedTab,
  type ClosedTab,
} from "./closed-tabs"
import type { SessionTab, Tab } from "./tabs"
import { migrateTabs } from "./tab-migration"
import type { ServerConnection } from "./server"

const server = "local\nhttp://localhost:4096" as ServerConnection.Key

function sessionTab(sessionId: string): SessionTab {
  return { type: "session", server, sessionId }
}

describe("tab migration", () => {
  test("drops null and malformed persisted tabs", () => {
    expect(
      migrateTabs([null, sessionTab("a"), { type: "session", server }, { type: "unknown", server }, "invalid"], server),
    ).toEqual([sessionTab("a")])
  })

  test("adds the fallback server to valid legacy tabs", () => {
    expect(migrateTabs([{ type: "session", sessionId: "a", dirBase64: "legacy" }], server)).toEqual([sessionTab("a")])
  })

  test("replaces invalid top-level persisted data", () => {
    expect(migrateTabs(null, server)).toEqual([])
    expect(migrateTabs({}, server)).toEqual([])
  })
})

describe("tab memory", () => {
  test("keeps state until its tab is removed", () => {
    createRoot((dispose) => {
      const memory = createTabMemory(getOwner())
      let disposed = 0
      const first = memory.ensure("tab", "prompt", () => {
        onCleanup(() => disposed++)
        return { value: "prompt" }
      })

      expect(memory.ensure("tab", "prompt", () => ({ value: "other" }))).toBe(first)
      expect(memory.get<typeof first>("tab", "prompt")).toBe(first)
      expect(memory.get("missing", "prompt")).toBeUndefined()
      expect(memory.ensure("other", "prompt", () => ({ value: "other" }))).not.toBe(first)

      memory.remove("tab")
      expect(disposed).toBe(1)
      expect(memory.ensure("tab", "prompt", () => ({ value: "new" }))).not.toBe(first)
      dispose()
    })
  })
})

describe("closed tab stack", () => {
  test("records session tabs with their index", () => {
    const stack = pushClosedTab([], sessionTab("a"), 2)

    expect(stack).toEqual([{ tab: sessionTab("a"), index: 2 }])
  })

  test("ignores draft tabs", () => {
    const draft: Tab = { type: "draft", draftID: "d1", server, directory: "/tmp" }

    expect(pushClosedTab([], draft, 0)).toEqual([])
  })

  test("caps the stack size", () => {
    const stack = Array.from({ length: 30 }, (_, i) => i).reduce<ClosedTab[]>(
      (acc, i) => pushClosedTab(acc, sessionTab(`s${i}`), i),
      [],
    )

    expect(stack).toHaveLength(25)
    expect(stack[0]?.tab.sessionId).toBe("s5")
    expect(stack.at(-1)?.tab.sessionId).toBe("s29")
  })

  test("pops the most recently closed tab", () => {
    const stack = [
      { tab: sessionTab("a"), index: 0 },
      { tab: sessionTab("b"), index: 1 },
    ]
    const result = takeClosedTab(stack, [])

    expect(result.entry?.tab.sessionId).toBe("b")
    expect(result.stack).toEqual([{ tab: sessionTab("a"), index: 0 }])
  })

  test("skips entries whose tab is already open", () => {
    const stack = [
      { tab: sessionTab("a"), index: 0 },
      { tab: sessionTab("b"), index: 1 },
    ]
    const result = takeClosedTab(stack, [sessionTab("b")])

    expect(result.entry?.tab.sessionId).toBe("a")
    expect(result.stack).toEqual([])
  })

  test("returns no entry when everything is open or empty", () => {
    expect(takeClosedTab([], []).entry).toBeUndefined()

    const result = takeClosedTab([{ tab: sessionTab("a"), index: 0 }], [sessionTab("a")])
    expect(result.entry).toBeUndefined()
    expect(result.stack).toEqual([])
  })

  test("purges removed sessions", () => {
    const stack = [
      { tab: sessionTab("a"), index: 0 },
      { tab: sessionTab("b"), index: 1 },
    ]

    expect(removeClosedTabs(stack, server, ["a"])).toEqual([{ tab: sessionTab("b"), index: 1 }])
  })

  test("does not navigate when a background tab closes", () => {
    const tabs = [sessionTab("a"), sessionTab("b"), sessionTab("c")]

    expect(nextTabAfterClose(tabs, 1, false)).toBeUndefined()
    expect(nextTabAfterClose(tabs, 1, true)).toEqual(sessionTab("c"))
    expect(nextTabAfterClose([sessionTab("a")], 0, true)).toBeNull()
  })
})

describe("archived session tabs", () => {
  test("removes only the selected chat and selects its next open neighbor", () => {
    const tabs = [sessionTab("a"), sessionTab("b"), sessionTab("c")]
    const result = removeSessionTabs(tabs, server, ["b"], tabs[1])

    expect(result.tabs).toEqual([tabs[0], tabs[2]])
    expect(result.removed).toEqual([tabs[1]])
    expect(result.next).toBe(tabs[2])
    expect(tabs.map((tab) => tab.sessionId)).toEqual(["a", "b", "c"])
  })

  test("preserves drafts and chats on other servers with the same session ID", () => {
    const selected = sessionTab("a")
    const remote = { ...selected, server: "remote" as ServerConnection.Key }
    const draft: Tab = { type: "draft", draftID: "draft", server, directory: "/project" }
    const result = removeSessionTabs([selected, draft, remote], server, ["a"], selected)

    expect(result.tabs).toEqual([draft, remote])
    expect(result.next).toBe(draft)
    expect(result.removed).toEqual([selected])
  })

  test("does not navigate when archiving a background chat", () => {
    const tabs = [sessionTab("a"), sessionTab("b"), sessionTab("c")]
    const result = removeSessionTabs(tabs, server, ["b"], tabs[2])

    expect(result.tabs).toEqual([tabs[0], tabs[2]])
    expect(result.next).toBeUndefined()
  })

  test("selects the previous open tab when archiving the last tab", () => {
    const tabs = [sessionTab("a"), sessionTab("b")]
    const result = removeSessionTabs(tabs, server, ["b"], tabs[1])

    expect(result.tabs).toEqual([tabs[0]])
    expect(result.next).toBe(tabs[0])
    expect(removeSessionTabs([tabs[0]], server, ["a"], tabs[0]).next).toBeNull()
  })

  test("repeated removal leaves surviving tabs untouched", () => {
    const tabs = [sessionTab("a"), sessionTab("b"), sessionTab("c")]
    const first = removeSessionTabs(tabs, server, ["b"], tabs[1])
    const second = removeSessionTabs(first.tabs, server, ["b"], tabs[2])

    expect(second.tabs).toEqual([tabs[0], tabs[2]])
    expect(second.removed).toEqual([])
    expect(second.next).toBeUndefined()
  })
})
