import { expect, test } from "bun:test"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { sessionAgentProgress } from "./session-agent-progress"

function tool(id: string, state: ToolPart["state"], name = "read"): ToolPart {
  return { id, sessionID: "child", messageID: "assistant", callID: id, type: "tool", tool: name, state }
}

test("shows an active call even when a parallel call finishes later", () => {
  const running = tool("running", { status: "running", input: {}, time: { start: 1 } })
  const completed = tool("done", { status: "completed", input: {}, output: "done", title: "Read file", metadata: {}, time: { start: 1, end: 2 } })
  const failed = tool("failed", { status: "error", input: {}, error: "Unavailable", time: { start: 1, end: 2 } })
  const result = sessionAgentProgress([
    running, completed, failed,
    tool("plan", { status: "completed", input: {}, output: "done", title: "Plan", metadata: {}, time: { start: 1, end: 2 } }, "todowrite"),
  ])
  expect(result.active?.id).toBe("running")
  expect(result.tools.length).toBe(3)
  expect(result.completed).toBe(1)
  expect(result.failed).toBe(1)
})

test("updates activity from running through completion and retains the latest visible text", () => {
  const finished = tool("done", { status: "completed", input: {}, output: "done", title: "Read file", metadata: {}, time: { start: 1, end: 2 } })
  const result = sessionAgentProgress([
    finished,
    { id: "text", sessionID: "child", messageID: "assistant", type: "text", text: "Found the relevant owner." },
  ])
  expect(result.active).toBeUndefined()
  expect(result.completed).toBe(1)
  expect(result.text).toBe("Found the relevant owner.")
})
