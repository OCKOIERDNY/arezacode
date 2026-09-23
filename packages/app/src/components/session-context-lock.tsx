import { Show } from "solid-js"
import { useMutation } from "@tanstack/solid-query"
import { Button } from "@opencode-ai/ui/button"
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
    <Show when={props.health.locked()}>
      <div class="flex flex-col gap-2 rounded-md border border-border-weak-base bg-background-base p-3 mb-2" data-component="session-context-lock">
        <p role="status" class="text-text-base">
          {language.t(props.health.readonly() ? "context.health.lockedMessage" : "context.health.finishingMessage")}
        </p>
        <p class="text-text-weak text-12-regular">{language.t("context.health.preserved")}</p>
        <Show when={props.health.readonly()}>
          <div class="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={action.isPending} onClick={() => action.mutate("copy")}>
              {language.t("context.health.copy")}
            </Button>
            <Button variant="primary" disabled={action.isPending} onClick={() => action.mutate("new")}>
              {language.t("context.health.newChat")}
            </Button>
          </div>
        </Show>
      </div>
    </Show>
  )
}
