import { describe, expect, test } from "bun:test"
import { readFileMention, writeFileMention } from "@opencode-ai/session-ui/prompt-file-mention"
import { buildRequestParts } from "./build-request-parts"

describe("composer file mention serialization", () => {
  test.each(["docs", "other-docs"])("preserves the server and URI for %s after text edits and DOM cloning", (server) => {
    const pill = document.createElement("span")
    pill.textContent = "@Guide"
    writeFileMention(pill, {
      path: "docs://guide",
      mime: "text/markdown",
      filename: "Guide",
      url: "docs://guide",
      source: {
        type: "resource",
        clientName: server,
        uri: "docs://guide",
        text: { value: "@Guide", start: 0, end: 6 },
      },
    })
    const restored = document.createElement("div")
    restored.innerHTML = pill.outerHTML
    const mention = restored.firstElementChild
    if (!(mention instanceof HTMLElement)) throw new Error("Missing mention")
    expect(readFileMention(mention, 12)).toEqual({
      type: "file", path: "docs://guide", content: "@Guide", start: 12, end: 18,
      mime: "text/markdown", filename: "Guide", url: "docs://guide",
      source: { type: "resource", clientName: server, uri: "docs://guide", text: { value: "@Guide", start: 12, end: 18 } },
    })
    const result = buildRequestParts({
      prompt: [readFileMention(mention, 12)],
      context: [],
      images: [],
      text: "Please read @Guide",
      messageID: "message",
      sessionID: "session",
      sessionDirectory: "/workspace",
    })
    for (const parts of [result.requestParts, result.optimisticParts]) {
      const file = parts.find((part) => part.type === "file")
      expect(file?.url).toBe("docs://guide")
      expect(file?.source).toEqual({
        type: "resource", clientName: server, uri: "docs://guide",
        text: { value: "@Guide", start: 12, end: 18 },
      })
    }
  })

  test("keeps ordinary files separate from MCP resources", () => {
    const pill = document.createElement("span")
    pill.textContent = "@docs/guide.md"
    writeFileMention(pill, { path: "docs/guide.md" })
    expect(readFileMention(pill, 3)).toEqual({
      type: "file", path: "docs/guide.md", content: "@docs/guide.md", start: 3, end: 17,
    })
  })
})
