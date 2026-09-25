import { createEffect, createMemo, For, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Spinner } from "@opencode-ai/ui/spinner"
import { finishStartup } from "@opencode-ai/ui/logo"
import { useSessionTabAvatarState } from "./layout/project-avatar-state"
import { OverflowText } from "@opencode-ai/ui/overflow-text"
import { useLayout } from "@/context/layout"
import { useSettings } from "@/context/settings"
import { useNotification } from "@/context/notification"
import { useTabs, tabKey } from "@/context/tabs"
import { useLanguage } from "@/context/language"
import { ServerConnection } from "@/context/server"
import { sessionTitle } from "@/utils/session-title"
import { shouldOpenSessionInBackground } from "./home-session-open"
import { createHomeController } from "./home/home-controller"
import { createHomeProjectsController } from "./home/home-projects-controller"
import { HomeProjects } from "./home/home-projects"
import { createHomeScrollController } from "./home/home-scroll-controller"
import { createHomeSessionsController, registerHomeCommandPalette } from "./home/home-sessions-controller"

export function HomeSidebar(props: { onCollapse: () => void; debugTools?: { visible: boolean; toggle: () => void } }) {
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  registerHomeCommandPalette(home)
  const layout = useLayout()
  const settings = useSettings()
  const notification = useNotification()
  const tabs = useTabs()
  const [state, setState] = createStore({ search: "" })
  const selectedDraft = () => {
    const route = layout.route()
    return route.type === "draft" ? route.draftID : undefined
  }
  const selected = (id: string, server: ServerConnection.Key) => {
    const route = layout.route()
    return route.type === "session" && route.sessionId === id && route.server === server
  }
  createEffect(() => {
    const route = layout.route()
    const tab = tabs.store.find((tab) =>
      route.type === "draft"
        ? tab.type === "draft" && tab.draftID === route.draftID
        : route.type === "session" &&
          tab.type === "session" &&
          tab.sessionId === route.sessionId &&
          tab.server === route.server,
    )
    const directory = tab?.type === "draft" ? tab.directory : tab ? tabs.info[tabKey(tab)]?.directory : undefined
    if (!tab || !directory) return
    untrack(() => {
      const conn = home.server.list().find((conn) => ServerConnection.key(conn) === tab.server)
      if (!conn) return
      const project = home.project
        .forServer(conn)
        .find((project) => project.worktree === directory || project.sandboxes?.includes(directory))
      home.selection.set({ server: tab.server, directory: project?.worktree ?? directory })
      if (project) home.server.context(conn).projects.expand(project.worktree)
    })
  })
  return (
    <div
      id="project-sidebar"
      data-component="project-sidebar"
      class="relative z-40 flex h-full min-h-0 max-w-[80vw] shrink-0 flex-col pl-3 max-md:absolute max-md:inset-y-2 max-md:left-0 max-md:h-auto max-md:bg-v2-background-bg-deep"
      style={{ width: `${Math.min(480, Math.max(220, layout.sidebar.width()))}px` }}
    >
      <input
        type="search"
        class="mx-1 mr-4 mt-4 h-8 shrink-0 rounded-md bg-v2-background-bg-layer-02 px-3 text-v2-text-text-base outline-none focus-visible:ring-1 focus-visible:ring-v2-border-border-muted"
        value={state.search}
        onInput={(event) => setState("search", event.currentTarget.value)}
        placeholder={projects.copy.language.t("home.sessions.search.placeholder")}
        aria-label={projects.copy.language.t("home.sessions.search.placeholder")}
      />
      <HomeProjects
        projects={projects}
        projectActive={(server, directory) => {
          const tab = tabs.store.find((tab) => tab.type === "draft" && tab.draftID === selectedDraft())
          return tab?.type === "draft" && tab.server === server && tab.directory === directory
        }}
        renderSessions={(expanded, conn, project) => {
          const sessions = createHomeSessionsController(home, Infinity, { server: conn, project, expanded })
          const records = createMemo<ReturnType<typeof sessions.data.searchRecords>>(
            (previous) =>
              expanded()
                ? sessions.data
                    .searchRecords()
                    .filter((record) => record.session.title.toLowerCase().includes(state.search.toLowerCase()))
                : previous,
            [],
          )
          const recordsByID = createMemo(() => new Map(records().map((record) => [record.session.id, record])))
          return (
            <div class="mt-1 mb-3 flex flex-col gap-0.5">
              <Show
                when={!sessions.data.loading()}
                fallback={
                  <span class="px-2 py-2 text-v2-text-text-muted">{projects.copy.language.t("common.loading")}</span>
                }
              >
                <For
                  each={[...recordsByID().keys()]}
                  fallback={
                    <span class="px-2 py-2 text-v2-text-text-faint">
                      {projects.copy.language.t("home.sessions.empty")}
                    </span>
                  }
                >
                  {(id) => {
                    const record = () => recordsByID().get(id)!
                    return (
                      <button
                        type="button"
                        data-component="home-session-row"
                        class="flex h-8 w-full shrink-0 items-center gap-2 rounded-md px-2 text-left text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-v2-border-border-muted"
                        classList={{ "bg-v2-background-bg-layer-03 text-v2-text-text-base": selected(record().session.id, sessions.session.server()) }}
                        aria-current={selected(record().session.id, sessions.session.server()) ? "page" : undefined}
                        onClick={(event) => {
                          notification
                            .ensureServerState(sessions.session.server())
                            .session.markViewed(record().session.id)
                          if (layout.session.width() === 0) layout.session.resize(600)
                          sessions.session.open(record().session, {
                            background: shouldOpenSessionInBackground({
                              button: event.button,
                              mac: /Mac|iPod|iPhone|iPad/.test(navigator.platform),
                              meta: event.metaKey,
                              ctrl: event.ctrlKey,
                              shift: event.shiftKey,
                              alt: event.altKey,
                            }),
                          })
                        }}
                      >
                        <OverflowText>{sessionTitle(record().session.title) || record().session.id}</OverflowText>
                        <SidebarSessionStatus
                          server={sessions.session.server()}
                          directory={record().session.directory}
                          sessionID={record().session.id}
                        />
                      </button>
                    )
                  }}
                </For>
              </Show>
            </div>
          )
        }}
      />
      <ResizeHandle
        direction="horizontal"
        edge={settings.general.sidebarPosition() === "right" ? "start" : "end"}
        class="max-md:hidden"
        size={Math.min(480, Math.max(220, layout.sidebar.width()))}
        min={220}
        max={480}
        onResize={layout.sidebar.resize}
        onCollapse={props.onCollapse}
        onCollapseChange={layout.projectSidebar.previewCollapse}
        collapseThreshold={160}
        aria-label={projects.copy.language.t("sidebar.nav.projectsAndSessions")}
      />
    </div>
  )
}

function SidebarSessionStatus(props: { server: ServerConnection.Key; directory: string; sessionID: string }) {
  const language = useLanguage()
  const state = useSessionTabAvatarState(
    () => props.server,
    () => props.directory,
    () => props.sessionID,
  )
  const label = () =>
    language.t(
      state.status() === "waiting"
        ? "notification.permission.title"
        : state.status() === "error"
          ? "notification.session.error.title"
          : state.status() === "complete"
            ? "notification.session.responseReady.title"
            : "common.loading",
    )
  return (
    <Show when={state.status()}>
      <span
        data-component="sidebar-session-status"
        data-status={state.status()}
        class="flex size-4 shrink-0 items-center justify-center"
        role="img"
        aria-label={label()}
        title={label()}
      >
        <Show
          when={state.status() === "working"}
          fallback={
            <span
              class="size-2 rounded-full"
              style={{
                "background-color":
                  state.status() === "waiting" ? "#fbbf24" : state.status() === "error" ? "#ef4444" : "#34d399",
              }}
            />
          }
        >
          <Spinner class="size-4" />
        </Show>
      </span>
    </Show>
  )
}

export function NewHome() {
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const language = useLanguage()
  const layout = useLayout()
  const settings = useSettings()
  let opening = false
  createEffect(() => {
    if (layout.ready() && settings.ready() && home.server.focusedSync().ready && !home.project.newSession()) finishStartup()
  })
  createEffect(() => {
    if (opening || !home.project.newSession() || !home.server.focused()) return
    opening = true
    untrack(home.project.openNewSession)
  })
  return (
    <div class="flex flex-1 self-stretch items-center justify-center">
      <ButtonV2
        icon="folder-add-left"
        variant="ghost-muted"
        onClick={() => {
          const conn = home.server.focused()
          if (conn) projects.project.choose(conn)
        }}
      >
        {language.t("home.project.add")}
      </ButtonV2>
    </div>
  )
}
