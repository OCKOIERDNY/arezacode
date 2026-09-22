import { expect, test } from "bun:test"
import { observeScrollView } from "@opencode-ai/ui/scroll-view"

test("scrollbars remeasure nested streaming text and replaced tool content", async () => {
  const viewport = document.createElement("div")
  const content = document.createElement("div")
  const nested = document.createElement("pre")
  const text = document.createTextNode("Initial output")
  nested.append(text)
  content.append(nested)
  viewport.append(content)
  document.body.append(viewport)
  let next = Promise.withResolvers<string | null>()
  const updates: (string | null)[] = []
  const dispose = observeScrollView(viewport, undefined, () => {
    updates.push(viewport.textContent)
    next.resolve(viewport.textContent)
  })
  try {
    expect(await next.promise).toBe("Initial output")
    next = Promise.withResolvers<string | null>()
    text.data = "Streaming output grew"
    expect(await next.promise).toBe("Streaming output grew")

    next = Promise.withResolvers<string | null>()
    nested.replaceChildren(document.createTextNode("Collapsed"))
    expect(await next.promise).toBe("Collapsed")

    dispose()
    nested.textContent = "After disposal"
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(updates).toEqual(["Initial output", "Streaming output grew", "Collapsed"])
  } finally {
    dispose()
    viewport.remove()
  }
})

test("disposing a scroll view cancels its pending measurement", async () => {
  const viewport = document.createElement("div")
  let updates = 0
  const dispose = observeScrollView(viewport, undefined, () => updates++)
  dispose()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  expect(updates).toBe(0)
})
