import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createAutoScroll } from "@opencode-ai/ui/hooks"

test("restores a paused chat before mounting without scrolling the previous chat", () => {
  createRoot((dispose) => {
    const scroll = createAutoScroll({ working: () => true })
    const previous = document.createElement("div")
    previous.scrollTop = 75
    scroll.scrollRef(previous)
    scroll.restore(true)
    expect(previous.scrollTop).toBe(75)
    expect(scroll.userScrolled()).toBe(true)

    const current = document.createElement("div")
    Object.defineProperties(current, {
      scrollHeight: { value: 1000 },
      clientHeight: { value: 200 },
    })
    current.scrollTop = 420
    scroll.scrollRef(current)
    scroll.handleScroll()
    scroll.scrollToBottom()
    expect(current.scrollTop).toBe(420)
    expect(scroll.userScrolled()).toBe(true)

    scroll.resume()
    expect(scroll.userScrolled()).toBe(false)
    expect(current.scrollTop).toBe(1000)
    dispose()
  })
})

test("restoring bottom-follow mode does not move a departing chat", () => {
  createRoot((dispose) => {
    const scroll = createAutoScroll({ working: () => true })
    const viewport = document.createElement("div")
    viewport.scrollTop = 420
    scroll.scrollRef(viewport)
    scroll.restore(true)
    scroll.restore(false)
    expect(viewport.scrollTop).toBe(420)
    expect(scroll.userScrolled()).toBe(false)
    dispose()
  })
})
