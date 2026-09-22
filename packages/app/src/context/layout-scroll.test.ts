import { describe, expect, test, vi } from "bun:test"
import { createScrollPersistence, type SessionScroll } from "./layout-scroll"

describe("createScrollPersistence", () => {
  test("keeps each chat's reading position and follow mode across switches and persistence", () => {
    const snapshots: Record<string, Record<string, SessionScroll>> = {}
    const options = {
      getSnapshot: (key: string) => snapshots[key],
      onFlush: (key: string, value: Record<string, SessionScroll>) => {
        snapshots[key] = value
      },
    }
    const scroll = createScrollPersistence(options)
    scroll.setScroll("server-a:chat-a", "timeline", { x: 0, y: 420, bottom: true })
    scroll.flushAll()
    scroll.setScroll("server-a:chat-a", "timeline", { x: 0, y: 420, bottom: false })
    scroll.setScroll("server-a:chat-b", "timeline", { x: 0, y: 900, bottom: true })
    expect(scroll.scroll("server-a:chat-a", "timeline")).toEqual({ x: 0, y: 420, bottom: false })
    expect(scroll.scroll("server-b:chat-a", "timeline")).toBeUndefined()
    scroll.flushAll()
    scroll.dispose()

    const restored = createScrollPersistence(options)
    expect(restored.scroll("server-a:chat-a", "timeline")).toEqual({ x: 0, y: 420, bottom: false })
    expect(restored.scroll("server-a:chat-b", "timeline")).toEqual({ x: 0, y: 900, bottom: true })
    restored.dispose()
  })

  test("debounces persisted scroll writes", () => {
    vi.useFakeTimers()
    try {
      const snapshot = {
        session: {
          review: { x: 0, y: 0 },
        },
      } as Record<string, Record<string, { x: number; y: number }>>
      const writes: Array<Record<string, { x: number; y: number }>> = []
      const scroll = createScrollPersistence({
        debounceMs: 10,
        getSnapshot: (sessionKey) => snapshot[sessionKey],
        onFlush: (sessionKey, next) => {
          snapshot[sessionKey] = next
          writes.push(next)
        },
      })

      for (const i of Array.from({ length: 30 }, (_, n) => n + 1)) {
        scroll.setScroll("session", "review", { x: 0, y: i })
      }

      vi.advanceTimersByTime(9)
      expect(writes).toHaveLength(0)

      vi.advanceTimersByTime(1)

      expect(writes).toHaveLength(1)
      expect(writes[0]?.review).toEqual({ x: 0, y: 30 })

      scroll.setScroll("session", "review", { x: 0, y: 30 })
      vi.advanceTimersByTime(20)

      expect(writes).toHaveLength(1)
      scroll.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  test("reseeds empty cache after persisted snapshot loads", () => {
    const snapshot = {
      session: {},
    } as Record<string, Record<string, { x: number; y: number }>>

    const scroll = createScrollPersistence({
      getSnapshot: (sessionKey) => snapshot[sessionKey],
      onFlush: () => {},
    })

    expect(scroll.scroll("session", "review")).toBeUndefined()

    snapshot.session = {
      review: { x: 12, y: 34 },
    }

    expect(scroll.scroll("session", "review")).toEqual({ x: 12, y: 34 })
    scroll.dispose()
  })
})
