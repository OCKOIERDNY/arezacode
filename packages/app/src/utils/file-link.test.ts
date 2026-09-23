import { describe, expect, test } from "bun:test"
import { sanitizeMarkdown } from "@opencode-ai/session-ui/markdown-cache"
import { markInlineCode } from "@opencode-ai/session-ui/markdown-inline-code"
import { createPathHelpers } from "@/context/file/path"
import { createOpenSessionFileTab } from "@/pages/session/helpers"
import { fileLinkPath, openMarkdownFileLink } from "./file-link"

describe("Markdown file links", () => {
  test("resolves local references relative to the displayed file", () => {
    expect(fileLinkPath("to-do.md")).toBe("to-do.md")
    expect(fileLinkPath("./guide.md#setup", "docs/README.md")).toBe("docs/./guide.md")
    expect(fileLinkPath("../to-do.md", "docs/README.md")).toBe("docs/../to-do.md")
    expect(fileLinkPath("/workspace/to-do.md", "docs/README.md")).toBe("/workspace/to-do.md")
    expect(fileLinkPath("file:///workspace/to-do.md")).toBe("file:///workspace/to-do.md")
    expect(fileLinkPath("C:\\workspace\\to-do.md")).toBe("C:\\workspace\\to-do.md")
  })

  test("leaves web links, fragments and other protocols alone", () => {
    for (const href of [
      "",
      "#heading",
      "?query",
      "https://example.com/a.md",
      "//example.com/a.md",
      "mailto:a@b.com",
      "javascript:alert(1)",
      "data:text/plain,test",
    ]) {
      expect(fileLinkPath(href)).toBeUndefined()
    }
  })

  test.each(["to-do.md", "/workspace/to-do.md", "file:///workspace/to-do.md"])(
    "opens %s through the sidebar file owner",
    (href) => {
      const root = document.createElement("div")
      root.dataset.component = "markdown"
      root.innerHTML = sanitizeMarkdown(`<a href="${href}"><code>to-do.md</code></a>`)
      const calls: string[] = []
      const path = createPathHelpers(() => "/workspace")
      const open = createOpenSessionFileTab({
        normalizeTab: path.tab,
        pathFromTab: path.pathFromTab,
        openTab: (tab) => calls.push(`open:${tab}`),
        loadFile: (file) => calls.push(`load:${file}`),
        openReviewPanel: () => calls.push("panel"),
        setActive: (tab) => calls.push(`active:${tab}`),
      })
      root.addEventListener("click", (event) => openMarkdownFileLink(event, open))
      const event = new MouseEvent("click", { bubbles: true, cancelable: true })
      root.querySelector("code")!.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(calls).toEqual(["open:file://to-do.md", "load:to-do.md", "panel", "active:file://to-do.md"])
    },
  )

  test("keeps encoded filenames intact until the file owner decodes them", () => {
    const path = createPathHelpers(() => "/workspace")
    expect(path.pathFromTab(path.tab(fileLinkPath("docs/my%20notes%23draft.md#heading")!))).toBe(
      "docs/my notes#draft.md",
    )
  })

  test("opens a blue inline filename mention through the sidebar file owner", () => {
    const root = document.createElement("div")
    root.dataset.component = "markdown"
    root.innerHTML = sanitizeMarkdown("<p>Check <code>to-do.md</code> next.</p>")
    markInlineCode(root)
    const code = root.querySelector("code")!
    expect(code.dataset.inlineCodeKind).toBe("path")
    expect(code.parentElement?.tagName).toBe("A")
    expect(code.parentElement?.getAttribute("href")).toBe("to-do.md")
    const calls: string[] = []
    const path = createPathHelpers(() => "/workspace")
    const open = createOpenSessionFileTab({
      normalizeTab: path.tab,
      pathFromTab: path.pathFromTab,
      openTab: (tab) => calls.push(`open:${tab}`),
      loadFile: (file) => calls.push(`load:${file}`),
      openReviewPanel: () => calls.push("panel"),
      setActive: (tab) => calls.push(`active:${tab}`),
    })
    root.addEventListener("click", (event) => openMarkdownFileLink(event, open), true)
    const event = new MouseEvent("click", { bubbles: true, cancelable: true })
    code.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(calls).toEqual(["open:file://to-do.md", "load:to-do.md", "panel", "active:file://to-do.md"])
  })

  test("decorating mentions preserves explicit links and code blocks without nesting anchors", () => {
    const root = document.createElement("div")
    root.innerHTML = sanitizeMarkdown(
      '<a href="docs/to-do.md"><code>to-do.md</code></a><pre><code>to-do.md</code></pre><code>window.api</code><code>notes#draft.md</code>',
    )
    markInlineCode(root)
    markInlineCode(root)
    expect(root.querySelectorAll("a").length).toBe(2)
    expect(root.querySelector("a")!.getAttribute("href")).toBe("docs/to-do.md")
    expect(root.querySelector("a a")).toBeNull()
    expect(root.querySelector("pre a")).toBeNull()
    expect(root.querySelector("a.file-link")!.getAttribute("href")).toBe("notes%23draft.md")
  })

  test("does not hijack modified clicks or application navigation", () => {
    const root = document.createElement("div")
    root.innerHTML = '<a href="to-do.md">to-do.md</a>'
    const calls: string[] = []
    root.addEventListener("click", (event) => openMarkdownFileLink(event, (path) => calls.push(path)))
    root.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    root.dataset.component = "markdown"
    root
      .querySelector("a")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }))
    expect(calls).toEqual([])
  })

  test("still sanitizes executable links and event handlers", () => {
    const root = document.createElement("div")
    root.innerHTML = sanitizeMarkdown(
      '<a href="javascript:alert(1)" onclick="alert(1)">unsafe</a><img src="file:///secret.png">',
    )
    expect(root.querySelector("a")!.hasAttribute("href")).toBe(false)
    expect(root.querySelector("a")!.hasAttribute("onclick")).toBe(false)
    expect(root.querySelector("img")!.hasAttribute("src")).toBe(false)
  })
})
