import type { SessionApi } from "@opencode-ai/client/promise"
import type { SessionMessage } from "@opencode-ai/schema/session-message"
import { listAllSessions } from "@/utils/session"

export type ContextUsageEntry = typeof SessionMessage.UsageEntry.Encoded & {
  role: "main" | "subagent"
  sessionID: string
}

export async function loadContextUsage(input: {
  sessionID: string
  session: Pick<SessionApi, "list">
  usage: (sessionID: string) => Promise<readonly (typeof SessionMessage.UsageEntry.Encoded)[]>
}) {
  const entries: ContextUsageEntry[] = []
  const pending = [input.sessionID]
  const visited = new Set<string>()
  for (const sessionID of pending) {
    if (visited.has(sessionID)) continue
    visited.add(sessionID)
    const [usage, children] = await Promise.all([
      input.usage(sessionID),
      listAllSessions(input.session, { parentID: sessionID }),
    ])
    entries.push(
      ...usage.map((entry) => ({
        ...entry,
        sessionID,
        role: sessionID === input.sessionID ? ("main" as const) : ("subagent" as const),
      })),
    )
    pending.push(...children.map((child) => child.id))
  }
  return entries
}
