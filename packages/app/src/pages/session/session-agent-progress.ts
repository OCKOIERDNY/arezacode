import type { Part, ToolPart } from "@opencode-ai/sdk/v2"

export function sessionAgentProgress(parts: readonly Part[]) {
  const tools = parts.filter((part): part is ToolPart => part.type === "tool" && part.tool !== "todowrite")
  const active = tools.findLast((part) => part.state.status === "running" || part.state.status === "pending")
  const latest = parts.findLast((part) => (part.type === "text" || part.type === "reasoning") && part.text.trim())
  return {
    tools,
    active,
    completed: tools.filter((part) => part.state.status === "completed").length,
    failed: tools.filter((part) => part.state.status === "error").length,
    text: latest?.type === "text" || latest?.type === "reasoning" ? latest.text : undefined,
  }
}
