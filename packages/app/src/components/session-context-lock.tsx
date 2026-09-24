import { Show } from "solid-js"
import { useMutation } from "@tanstack/solid-query"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { ServerConnection } from "@/context/server"
import { useTabs } from "@/context/tabs"
import type { useSessionHealth } from "@/hooks/use-session-health"
import { showToast } from "@/utils/toast"

export function SessionContextLock(props: {
  sessionID?: string
  health: ReturnType<typeof useSessionHealth>
  localContext: () => string
  independent?: boolean
  onIndependent?: () => void
}) {
  const language = useLanguage()
  const sdk = useSDK()
  const server = useServerSDK()
  const tabs = useTabs()
  const action = useMutation(() => ({
    mutationFn: async (mode: "copy" | "new") => {
      const sessionID = props.sessionID
      if (!sessionID) return
      const target = { server: ServerConnection.key(server().server), directory: sdk().directory }
      const local = props.localContext()
      const handoff = await sdk().api.session.handoff({ sessionID })
      const text = [handoff.text, local].filter(Boolean).join("\n\n")
      if (mode === "new") {
        await tabs.newDraft(target, text)
        return
      }
      await navigator.clipboard.writeText(text)
      showToast({ title: language.t("context.health.copied") })
    },
    onError: (error: Error) => showToast({ variant: "error", title: language.t("common.requestFailed"), description: error.message }),
  }))
  return (
    <Show when={props.health.state() !== "healthy" && !props.independent}>
      <div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-v2-state-bg-warning px-3 py-1 text-v2-state-fg-warning" data-component="session-context-lock">
        <Tooltip
          contentClass="max-w-72 whitespace-normal"
          value={
            <div>
              <p>{language.t(props.health.state() === "near" ? "context.health.nearMessage" : props.health.readonly() ? "context.health.lockedMessage" : "context.health.finishingMessage")}</p>
              <Show when={props.health.locked()}><p>{language.t("context.health.preserved")}</p></Show>
            </div>
          }
        >
          <button type="button" class="flex items-center gap-2 py-1 text-12-regular">
            <Icon name="warning" size="small" />
            <span role="status" aria-live="polite">{language.t(props.health.locked() ? "context.health.inputLocked" : "context.health.near")}</span>
          </button>
        </Tooltip>
        <Show when={props.health.readonly()}>
          <div class="ms-auto flex items-center gap-1">
            <Show when={props.onIndependent}>
              <Button size="small" variant="ghost" onClick={() => props.onIndependent?.()}>
                {language.t("prompt.independent.label")}
              </Button>
            </Show>
            <Button size="small" variant="ghost" disabled={action.isPending} onClick={() => action.mutate("copy")}>
              {language.t("context.health.copy")}
            </Button>
            <Button size="small" variant="ghost" disabled={action.isPending} onClick={() => action.mutate("new")}>
              {language.t("context.health.newChat")}
            </Button>
          </div>
        </Show>
      </div>
    </Show>
  )
}
