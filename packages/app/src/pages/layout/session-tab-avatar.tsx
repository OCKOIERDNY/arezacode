import type { LocalProject } from "@/context/layout"
import { getProjectAvatarVariant } from "@/context/layout"
import { ServerConnection } from "@/context/server"
import { displayName, getProjectAvatarSource } from "@/pages/layout/helpers"
import { useSessionTabAvatarState } from "@/pages/layout/project-avatar-state"
import { ProjectAvatar } from "@opencode-ai/ui/v2/project-avatar-v2"
import { SessionProgressIndicatorV2 } from "@opencode-ai/session-ui/v2/session-progress-indicator-v2"
import { createMemo, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { useGlobal } from "@/context/global"
import { createSessionHealth } from "@/hooks/use-session-health"

export function SessionTabAvatar(props: {
  project?: LocalProject
  directory: string
  sessionId: string
  server: ServerConnection.Key
  revealProjectOnHover?: boolean
}) {
  const global = useGlobal()
  const server = createMemo(() => {
    const connection = global.servers.list().find((item) => ServerConnection.key(item) === props.server)
    return connection ? global.ensureServerCtx(connection) : undefined
  })
  const health = createSessionHealth(
    () => props.sessionId,
    () => server()?.sdk.ensureDirSdkContext(props.directory),
    () => server()?.sync.session.data.session_working(props.sessionId) ?? false,
  )
  const state = useSessionTabAvatarState(
    () => props.server,
    () => props.directory,
    () => props.sessionId,
  )
  return (
    <SessionTabAvatarView
      project={props.project}
      directory={props.directory}
      revealProjectOnHover={props.revealProjectOnHover}
      unread={state.unread()}
      loading={state.loading()}
      locked={health.locked()}
    />
  )
}

export function SessionTabAvatarView(props: {
  project?: LocalProject
  directory: string
  revealProjectOnHover?: boolean
  unread: boolean
  loading: boolean
  locked?: boolean
}) {
  const language = useLanguage()
  const projectAvatar = () => (
    <ProjectAvatar
      fallback={displayName(props.project ?? { worktree: props.directory })}
      src={getProjectAvatarSource(props.project?.id, props.project?.icon)}
      variant={getProjectAvatarVariant(props.project?.icon?.color)}
      unread={props.unread}
    />
  )
  return (
    <Show when={props.loading || props.locked} fallback={projectAvatar()}>
      <span class="relative block size-4 shrink-0">
        <Show
          when={props.locked}
          fallback={
            <SessionProgressIndicatorV2
              class={`absolute inset-0 ${props.revealProjectOnHover === false ? "" : "group-hover:invisible"}`}
            />
          }
        >
          <span
            class="absolute inset-0 text-icon-weak"
            role="img"
            aria-label={language.t("context.health.inputLocked")}
            title={language.t("context.health.inputLocked")}
          >
            <Icon name="lock" size="small" />
          </span>
        </Show>
        <Show when={!props.locked && props.revealProjectOnHover !== false}>
          <span class="invisible absolute inset-0 group-hover:visible">{projectAvatar()}</span>
        </Show>
      </span>
    </Show>
  )
}
