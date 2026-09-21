import { Effect } from "effect"
import type { Permission } from "@opencode-ai/schema/permission"
import type { Session } from "@opencode-ai/schema/session"
import type { SessionStore } from "../session/store"

export const resolveApprovalMode = Effect.fn(function* (session: Session.Info | undefined, sessions: SessionStore.Interface) {
  const seen = new Set<string>()
  let current = session
  while (current && current.approvalMode === undefined && current.parentID && !seen.has(current.parentID)) {
    seen.add(current.id)
    current = yield* sessions.get(current.parentID)
  }
  return current?.approvalMode
})

export function approvalEffect(mode: Permission.ApprovalMode | undefined, action: string) {
  if (!mode || mode === "default") return
  return mode === "full" || (mode === "auto" && ["read", "edit", "glob", "grep", "list", "ls"].includes(action))
    ? "allow" as const
    : "ask" as const
}
