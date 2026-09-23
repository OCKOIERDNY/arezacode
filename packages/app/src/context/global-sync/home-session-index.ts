import type { Event, Session, SessionV2Info } from "@opencode-ai/sdk/v2/client"
import type { QueryClient } from "@tanstack/solid-query"
import type { ServerApi } from "@/utils/server"
import { compareSessionRecent } from "./session-trim"
import { pathKey } from "@/utils/path-key"

export const HOME_SESSION_LIMIT = 64

export type HomeSessionQuery = {
  directories: string[]
  limit: number
  search?: string
  matchingDirectories?: string[]
}

export type HomeSessionEvent = {
  type: "session.created" | "session.updated" | "session.deleted"
  properties: { sessionID: string; info: Session }
}
export type HomeSessionEvents = {
  sequence: number
  entries: Array<{ sequence: number; event: HomeSessionEvent }>
}
export type HomeSessionIndex = {
  sessions: Session[]
  eventSequence: number
  query?: HomeSessionQuery
}

export const homeSessionIndexKey = (server: string) => ["home", "session-index", server] as const
export const homeSessionEventsKey = (server: string) => ["home", "session-events", server] as const

export async function loadHomeSessionIndex(
  list: ServerApi["session"]["list"],
  query: HomeSessionQuery,
  eventSequence = 0,
  signal?: AbortSignal,
) {
  if (!query.directories.length) return { sessions: [], eventSequence, query }
  const filters = [
    { directories: query.directories, search: query.search },
    ...(query.search && query.matchingDirectories?.length ? [{ directories: query.matchingDirectories }] : []),
  ]
  const pages = await Promise.all(filters.map((filter) => list({
    ...filter,
    limit: Math.min(HOME_SESSION_LIMIT, query.limit),
    order: "desc",
    sort: "updated",
    roots: true,
    archived: false,
  }, { signal })))
  return {
    sessions: selectHomeSessions(parseHomeSessionIndex(pages.flatMap((page) => page.data)), query),
    eventSequence,
    query,
  }
}

export function appendHomeSessionEvent(current: HomeSessionEvents | undefined, event: HomeSessionEvent) {
  const sequence = (current?.sequence ?? 0) + 1
  return {
    sequence,
    entries: [...(current?.entries ?? []), { sequence, event }],
  }
}

export function trimHomeSessionEvents(current: HomeSessionEvents | undefined, sequence: number): HomeSessionEvents {
  return {
    sequence: current?.sequence ?? sequence,
    entries: (current?.entries ?? []).filter((entry) => entry.sequence > sequence),
  }
}

export function homeSessionIndexSessions(index: HomeSessionIndex | undefined, events: HomeSessionEvents | undefined) {
  if (!index) return []
  return selectHomeSessions((events?.entries ?? [])
    .filter((entry) => entry.sequence > index.eventSequence)
    .reduce((sessions, entry) => applyHomeSessionEvent(sessions, entry.event), index.sessions), index.query)
}

export function homeSessionIndexRefresh(event: Event["type"], connected: boolean) {
  if (event === "server.connected") return { connected: true, refetch: connected }
  return {
    connected,
    refetch: event === "global.disposed" || event === "session.next.moved",
  }
}

export function createHomeSessionIndexCache(queryClient: QueryClient, server: string) {
  const indexKey = homeSessionIndexKey(server)
  const eventsKey = homeSessionEventsKey(server)
  let connected = false
  const removed = new Set<string>()
  const pending = new Map<number, number>()

  const rebase = (events: HomeSessionEvents) => {
    queryClient.setQueriesData<HomeSessionIndex>({ queryKey: indexKey }, (index) => index && ({
      ...index,
      sessions: homeSessionIndexSessions(index, events),
      eventSequence: events.sequence,
    }))
  }

  return {
    client: queryClient,
    indexKey,
    eventsKey,
    begin() {
      const sequence = queryClient.getQueryData<HomeSessionEvents>(eventsKey)?.sequence ?? 0
      pending.set(sequence, (pending.get(sequence) ?? 0) + 1)
      return sequence
    },
    complete(sequence: number) {
      const count = pending.get(sequence) ?? 0
      if (count <= 1) pending.delete(sequence)
      if (count > 1) pending.set(sequence, count - 1)
      const events = queryClient.getQueryData<HomeSessionEvents>(eventsKey)
      if (events) rebase(events)
      queryClient.setQueryData<HomeSessionEvents>(eventsKey, (current) =>
        trimHomeSessionEvents(current, Math.min(sequence, ...pending.keys())),
      )
    },
    sessions(index: HomeSessionIndex | undefined, events: HomeSessionEvents | undefined) {
      const sessions = homeSessionIndexSessions(index, events)
      return removed.size === 0 ? sessions : sessions.filter((session) => !removed.has(session.id))
    },
    apply(event: HomeSessionEvent) {
      if (!queryClient.getQueriesData({ queryKey: indexKey }).length) return
      const next = appendHomeSessionEvent(queryClient.getQueryData<HomeSessionEvents>(eventsKey), event)
      if (pending.size || queryClient.isFetching({ queryKey: indexKey }) > 0) {
        queryClient.setQueryData(eventsKey, next)
        return
      }

      rebase(next)
      queryClient.setQueryData<HomeSessionEvents>(eventsKey, { sequence: next.sequence, entries: [] })
    },
    remove(sessionID: string) {
      removed.add(sessionID)
      queryClient.setQueriesData<HomeSessionIndex>({ queryKey: indexKey }, (index) => {
        if (!index) return index
        const at = index.sessions.findIndex((session) => session.id === sessionID)
        if (at === -1) return index
        return { ...index, sessions: index.sessions.toSpliced(at, 1) }
      })
      void queryClient.invalidateQueries({ queryKey: indexKey, refetchType: "active" })
    },
    refresh(event: Event["type"]) {
      const result = homeSessionIndexRefresh(event, connected)
      connected = result.connected
      if (!result.refetch) return
      void queryClient.refetchQueries({ queryKey: indexKey, type: "active" })
    },
  }
}

type HomeSessionSummary = Omit<SessionV2Info, "time" | "revert"> & {
  time: { created: number; updated: number; archived?: number | null }
}

export function parseHomeSessionIndex(sessions: readonly HomeSessionSummary[]): Session[] {
  return sessions.flatMap((item) => {
    if (item.parentID || typeof item.time.archived === "number") return []
    return [toLegacySummary(item)]
  })
}

export function selectHomeSessions(sessions: Session[], query?: HomeSessionQuery) {
  const directories = query && new Set(query.directories.map(pathKey))
  const matching = new Set(query?.matchingDirectories?.map(pathKey))
  const search = query?.search?.toLowerCase()
  return [...new Map(sessions.map((session) => [session.id, session])).values()]
    .filter((session) => !session.parentID && typeof session.time.archived !== "number")
    .filter((session) => !directories || directories.has(pathKey(session.directory)))
    .filter((session) => !search || session.title.toLowerCase().includes(search) || matching.has(pathKey(session.directory)))
    .sort(compareSessionRecent)
    .slice(0, Math.min(HOME_SESSION_LIMIT, query?.limit ?? HOME_SESSION_LIMIT))
}

export function applyHomeSessionEvent(sessions: Session[], event: HomeSessionEvent) {
  const info = event.properties.info
  const index = sessions.findIndex((session) => session.id === info.id)
  if (event.type === "session.deleted" || info.parentID || typeof info.time.archived === "number") {
    if (index === -1) return sessions
    return sessions.toSpliced(index, 1)
  }
  if (event.type !== "session.created" && event.type !== "session.updated") return sessions
  if (index === -1) return [...sessions, info]
  return sessions.with(index, info)
}

function toLegacySummary(session: HomeSessionSummary): Session {
  return {
    id: session.id,
    slug: session.id,
    projectID: session.projectID,
    workspaceID: session.location.workspaceID,
    directory: session.location.directory,
    path: session.subpath,
    parentID: session.parentID,
    cost: session.cost,
    tokens: session.tokens,
    title: session.title,
    agent: session.agent,
    model: session.model,
    version: "",
    time: { ...session.time, archived: session.time.archived ?? undefined },
  }
}
