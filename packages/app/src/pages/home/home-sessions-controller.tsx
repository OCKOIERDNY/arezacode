import type { Session } from "@opencode-ai/sdk/v2/client"
import { preloadMarkdown } from "@opencode-ai/session-ui/markdown-cache"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useQuery } from "@tanstack/solid-query"
import { DateTime } from "luxon"
import { type Accessor, createEffect, createMemo, createRoot, type JSX, startTransition } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useCommand } from "@/context/command"
import {
  loadHomeSessionIndex,
  HOME_SESSION_LIMIT,
  type HomeSessionQuery,
  type HomeSessionEvents,
} from "@/context/global-sync/home-session-index"
import type { LocalProject } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { ServerConnection } from "@/context/server"
import { sessionHasOpenTab, useTabs } from "@/context/tabs"
import { compareSessionTime, displayName, errorMessage, projectForSession } from "@/pages/layout/helpers"
import { useSessionTabAvatarState } from "@/pages/layout/project-avatar-state"
import { pathKey } from "@/utils/path-key"
import { showToast } from "@/utils/toast"
import { Binary } from "@opencode-ai/core/util/binary"
import { archiveHomeSession } from "../home-session-archive"
import type { HomeController } from "./home-controller"

export type HomeSessionRecord = {
  session: Session
  project: LocalProject
  projectName: string
}

export type HomeSessionGroup = {
  id: "today" | "yesterday" | "older"
  title: string
  sessions: HomeSessionRecord[]
}

export type OpenSessionOptions = { background?: boolean }

export function createHomeSessionsController(
  home: HomeController,
  limit = HOME_SESSION_LIMIT,
  scope?: { server: ServerConnection.Any; project: Accessor<LocalProject>; expanded: Accessor<boolean> },
) {
  const tabs = useTabs()
  const command = useCommand()
  const dialog = useDialog()
  const language = useLanguage()
  const server = () => scope?.server ?? home.server.focused()
  const context = () => scope ? home.server.context(scope.server) : home.server.focusedContext()
  const projects = () => scope ? home.project.forServer(scope.server) : home.project.list()
  const selectedProject = () => scope ? scope.project() : home.project.selected()
  const serverKey = () => scope ? ServerConnection.key(scope.server) : home.selection.value().server
  const projectDirectories = createMemo(() => {
    const project = selectedProject()
    if (!project) return projects().flatMap(directories)
    return directories(project)
  })
  const projectByID = createMemo(
    () => new Map(projects().flatMap((project) => (project.id ? [[project.id, project] as const] : []))),
  )
  const homeSessions = () => (context()?.sync ?? home.server.focusedSync()).homeSessions
  const queryClient = () => homeSessions().client
  const [search, setSearch] = createStore({ value: "" })
  const query = createMemo<HomeSessionQuery>(() => ({
    directories: [...new Set(projectDirectories())].sort(),
    limit: Math.min(HOME_SESSION_LIMIT, limit),
  }))
  const searchQuery = createMemo<HomeSessionQuery>(() => ({
    ...query(),
    search: search.value,
    matchingDirectories: projects()
      .filter((project) => displayName(project).toLowerCase().includes(search.value.toLowerCase()))
      .flatMap(directories)
      .filter((directory) => query().directories.some((item) => pathKey(item) === pathKey(directory)))
      .sort(),
  }))
  const enabled = () => !!context() && (!scope || scope.expanded()) && query().directories.length > 0
  const load = async (query: HomeSessionQuery, signal: AbortSignal) => {
    const ctx = context()
    if (!ctx) return { sessions: [], eventSequence: 0, query }
    const cache = homeSessions()
    const eventSequence = cache.begin()
    try {
      return await loadHomeSessionIndex(
        (input, options) => ctx.sdk.api.session.list(input, options),
        query,
        eventSequence,
        signal,
      )
    } finally {
      cache.complete(eventSequence)
    }
  }
  const sessionEventLoad = useQuery(
    () => ({
      queryKey: homeSessions().eventsKey,
      queryFn: async (): Promise<HomeSessionEvents> => ({ sequence: 0, entries: [] }),
      initialData: { sequence: 0, entries: [] } satisfies HomeSessionEvents,
      enabled: false,
    }),
    queryClient,
  )
  const sessionLoad = useQuery(
    () => ({
      queryKey: [...homeSessions().indexKey, query()],
      enabled: enabled(),
      queryFn: ({ signal }) => load(query(), signal),
      retry: false,
      staleTime: 30_000,
      refetchOnMount: true,
      refetchOnReconnect: true,
    }),
    queryClient,
  )
  const searchLoad = useQuery(
    () => ({
      queryKey: [...homeSessions().indexKey, searchQuery()],
      enabled: enabled() && !!search.value,
      queryFn: ({ signal }) => load(searchQuery(), signal),
      retry: false,
      staleTime: 30_000,
      gcTime: 60_000,
    }),
    queryClient,
  )
  const indexedSessions = createMemo(() => homeSessions().sessions(sessionLoad.data, sessionEventLoad.data))
  const allRecords = createMemo(() =>
    buildHomeSessionRecords({
      sessions: indexedSessions,
      projectDirectories,
      projects,
      projectByID,
    }),
  )
  const records = createMemo(() => allRecords().slice(0, limit))
  const searchRecords = createMemo(() => !search.value ? allRecords() : buildHomeSessionRecords({
    sessions: () => homeSessions().sessions(searchLoad.data, sessionEventLoad.data),
    projectDirectories,
    projects,
    projectByID,
  }))
  const groups = createMemo(() => groupSessions(records(), language))
  const prefetched = new Set<string>()

  createEffect(() => {
    if (scope && !scope.expanded()) return
    const ctx = context()
    const conn = server()
    if (!ctx || !conn) return
    records()
      .slice(0, 2)
      .forEach((record) => {
        const key = `${ServerConnection.key(conn)}\0${record.session.id}`
        if (prefetched.has(key)) return
        prefetched.add(key)
        createRoot((dispose) => {
          try {
            void ctx.sync.session
              .sync(record.session.id)
              .then(() =>
                Promise.all(
                  (ctx.sync.session.data.message[record.session.id] ?? []).flatMap((message) =>
                    (ctx.sync.session.data.part[message.id] ?? []).flatMap((part) => {
                      if (part.type !== "text" || !part.text) return []
                      return preloadMarkdown(part.text, part.id)
                    }),
                  ),
                ),
              )
              .catch(() => {})
              .finally(dispose)
          } catch {
            dispose()
          }
        })
      })
  })

  if (!scope) command.register("home.palette", () => [
    {
      id: "command.palette",
      title: language.t("command.palette"),
      hidden: true,
      onSelect: async () => {
        const conn = home.server.focused()
        if (!conn) return
        const ctx = home.server.focusedContext()
        if (!ctx) return
        const { DialogHomeCommandPaletteV2 } = await import("@/components/dialog-command-palette-v2")
        void dialog.show(() => (
          <DialogHomeCommandPaletteV2
            server={conn}
            onSelectSession={(entry) => {
              if (!entry.sessionID || !entry.directory || !entry.server) return
              const sessionID = entry.sessionID
              const server = entry.server
              const directory = entry.project?.worktree ?? entry.directory
              ctx.projects.open(directory)
              ctx.projects.touch(directory)
              void startTransition(() => {
                const tab = tabs.addSessionTab({ server, sessionId: sessionID })
                tabs.select(tab)
              })
            }}
          />
        ))
      },
    },
  ])

  return {
    copy: {
      language,
    },
    data: {
      records,
      groups,
      loading: () => sessionLoad.isLoading,
      searchRecords,
      searchQuery: () => search.value,
      searchLoading: () => searchLoad.isFetching,
    },
    session: {
      search: (value: string) => setSearch("value", value),
      showProjectName: () => !selectedProject(),
      server: serverKey,
      canCreate: () => !!home.project.newSession(),
      create: home.project.openNewSession,
      open: (session: Session, options?: OpenSessionOptions) => {
        const directoryKey = pathKey(session.directory)
        const project =
          projects()
            .find(
              (item) =>
                pathKey(item.worktree) === directoryKey ||
                item.sandboxes?.some((sandbox) => pathKey(sandbox) === directoryKey),
            ) ?? projectForSession(session, projects(), projectByID())
        const conn = server()
        if (!conn) return
        const directory = project?.worktree ?? session.directory
        const ctx = context()
        if (!ctx) return
        ctx.projects.open(directory)
        if (options?.background) {
          tabs.addSessionTab({ server: ServerConnection.key(conn), sessionId: session.id })
          return
        }
        ctx.projects.touch(directory)
        void startTransition(() => {
          const tab = tabs.addSessionTab({ server: ServerConnection.key(conn), sessionId: session.id })
          tabs.select(tab)
        })
      },
      archive: async (session: Session) => {
        const conn = server()
        const ctx = context()
        if (!conn || !ctx) return
        const [, setStore] = ctx.sync.child(session.directory)
        if ((await ctx.sdk.protocol) !== "v1") return
        await archiveHomeSession({
          server: ServerConnection.key(conn),
          session,
          archive: (sessionID) =>
            ctx.sdk.client.session.update({
              sessionID,
              directory: session.directory,
              time: { archived: Date.now() },
            }),
          remove: () => {
            setStore(
              produce((draft) => {
                const match = Binary.search(draft.session, session.id, (item) => item.id)
                if (match.found) draft.session.splice(match.index, 1)
              }),
            )
            homeSessions().remove(session.id)
          },
          onError: (cause) =>
            showToast({
              title: language.t("common.requestFailed"),
              description: errorMessage(cause, language.t("common.requestFailed")),
            }),
        })
      },
    },
    tab: {
      isOpen: (record: HomeSessionRecord) =>
        sessionHasOpenTab(tabs.store, serverKey(), record.session),
    },
  }
}

function directories(project: LocalProject) {
  return [project.worktree, ...(project.sandboxes ?? [])]
}

function buildHomeSessionRecords(input: {
  sessions: () => Session[]
  projectDirectories: () => string[]
  projects: () => LocalProject[]
  projectByID: () => Map<string, LocalProject>
}) {
  const directories = new Set(input.projectDirectories().map(pathKey))
  const sessions = input.sessions().filter((session) => directories.has(pathKey(session.directory)))
  return [...new Map(sessions.map((session) => [session.id, session] as const)).values()]
    .sort(compareSessionTime)
    .flatMap((session) => {
      const directory = pathKey(session.directory)
      const project =
        input
          .projects()
          .find(
            (item) =>
              pathKey(item.worktree) === directory || item.sandboxes?.some((sandbox) => pathKey(sandbox) === directory),
          ) ?? projectForSession(session, input.projects(), input.projectByID())
      if (!project) return []
      return { session, project, projectName: displayName(project) }
    })
}

export function homeSessionSearchKey(record: HomeSessionRecord) {
  return `${pathKey(record.session.directory)}:${record.session.id}`
}

function groupSessions(records: HomeSessionRecord[], language: ReturnType<typeof useLanguage>): HomeSessionGroup[] {
  const now = DateTime.local()
  const yesterday = now.minus({ days: 1 })
  const todaySessions = records.filter((record) =>
    DateTime.fromMillis(record.session.time.updated ?? record.session.time.created).hasSame(now, "day"),
  )
  const yesterdaySessions = records.filter((record) =>
    DateTime.fromMillis(record.session.time.updated ?? record.session.time.created).hasSame(yesterday, "day"),
  )
  const olderSessions = records.filter((record) => {
    const time = DateTime.fromMillis(record.session.time.updated ?? record.session.time.created)
    return !time.hasSame(now, "day") && !time.hasSame(yesterday, "day")
  })
  const olderTitle =
    todaySessions.length === 0 && yesterdaySessions.length === 0
      ? language.t("sidebar.project.recentSessions")
      : language.t("home.sessions.group.older")
  return [
    { id: "today" as const, title: language.t("home.sessions.group.today"), sessions: todaySessions },
    { id: "yesterday" as const, title: language.t("home.sessions.group.yesterday"), sessions: yesterdaySessions },
    { id: "older" as const, title: olderTitle, sessions: olderSessions },
  ].filter((group) => group.sessions.length > 0)
}

export type HomeSessionsController = ReturnType<typeof createHomeSessionsController>

export function HomeSessionStatusController(props: {
  server: Accessor<ServerConnection.Key>
  record: HomeSessionRecord
  isOpenTab: (record: HomeSessionRecord) => boolean
  render: (state: { unread: Accessor<boolean>; loading: Accessor<boolean>; open: Accessor<boolean> }) => JSX.Element
}) {
  const avatar = useSessionTabAvatarState(
    props.server,
    () => props.record.session.directory,
    () => props.record.session.id,
  )
  return props.render({
    unread: avatar.unread,
    loading: avatar.loading,
    open: () => props.isOpenTab(props.record),
  })
}
