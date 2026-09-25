import type { SessionTab, Tab } from "./tabs"

export type ClosedTab = {
  tab: SessionTab
  index: number
}

const CLOSED_TAB_LIMIT = 25

// Only session tabs are recorded; closing a draft tab deletes its persisted
// state, so a reopened draft would come back empty anyway.
export function pushClosedTab(stack: ClosedTab[], tab: Tab, index: number): ClosedTab[] {
  if (tab.type !== "session") return stack
  return [...stack, { tab: { ...tab }, index }].slice(-CLOSED_TAB_LIMIT)
}

// Pops the most recently closed tab that is not open again,
// discarding stale entries along the way.
export function takeClosedTab(stack: ClosedTab[], tabs: Tab[]): { entry?: ClosedTab; stack: ClosedTab[] } {
  const remaining = [...stack]
  while (remaining.length) {
    const entry = remaining.pop()
    if (entry && !isOpen(tabs, entry.tab)) return { entry, stack: remaining }
  }
  return { stack: remaining }
}

export function removeClosedTabs(stack: ClosedTab[], server: SessionTab["server"], sessionIDs: string[]) {
  const removed = new Set(sessionIDs)
  return stack.filter((entry) => entry.tab.server !== server || !removed.has(entry.tab.sessionId))
}

export function removeSessionTabs(
  tabs: Tab[],
  server: SessionTab["server"],
  sessionIDs: string[],
  current?: SessionTab,
) {
  const ids = new Set(sessionIDs)
  const removed = tabs.filter((tab) => tab.type === "session" && tab.server === server && ids.has(tab.sessionId))
  const remaining = tabs.filter((tab) => !removed.includes(tab))
  const index = current ? tabs.indexOf(current) : -1
  const next =
    current && index !== -1 && removed.includes(current)
      ? tabs.slice(index + 1).find((tab) => !removed.includes(tab)) ??
        tabs.slice(0, index).findLast((tab) => !removed.includes(tab)) ??
        null
      : undefined
  return { tabs: remaining, removed, next }
}

export function nextTabAfterClose(tabs: Tab[], index: number, active: boolean) {
  if (!active) return undefined
  return tabs[index + 1] ?? tabs[index - 1] ?? null
}

function isOpen(tabs: Tab[], tab: SessionTab) {
  return tabs.some((item) => item.type === "session" && item.server === tab.server && item.sessionId === tab.sessionId)
}
