import { createEffect, createMemo, createResource, For, onCleanup, Show } from "solid-js"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { useData } from "@opencode-ai/session-ui/context"
import { Button } from "@opencode-ai/ui/button"
import { EmptyState } from "@opencode-ai/ui/empty-state"
import { Icon } from "@opencode-ai/ui/icon"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useServerSync } from "@/context/server-sync"
import { useProviders } from "@/hooks/use-providers"
import { useSessionLayout } from "./session-layout"

export function SessionAgentsPanel() {
  const sdk = useSDK()
  const sync = useSync()
  const server = useServerSync()
  const data = useData()
  const language = useLanguage()
  const providers = useProviders(() => sdk().directory)
  const { params } = useSessionLayout()
  const key = createMemo(() =>
    JSON.stringify([
      params.id,
      sync()
        .data.session.filter((session) => session.parentID)
        .map((session) => session.id),
    ]),
  )
  const [agents, { refetch }] = createResource(key, async () => {
    const result: Session[] = []
    const pending = params.id ? [params.id] : []
    const seen = new Set(pending)
    const client = sdk().client
    const current = sync()
    while (pending.length) {
      const children = await Promise.all(pending.splice(0).map((sessionID) => client.session.children({ sessionID })))
      for (const response of children) {
        for (const child of response.data ?? []) {
          if (seen.has(child.id)) continue
          seen.add(child.id)
          result.push(child)
          pending.push(child.id)
        }
      }
    }
    await Promise.all(result.map((child) => current.session.sync(child.id)))
    return result
  })
  const rows = createMemo(() =>
    (agents.error ? [] : (agents.latest ?? []))
      .map((session) => {
        const messages = sync().data.message[session.id] ?? []
        const last = messages.findLast((message) => message.role === "assistant")
        const tool = messages
          .flatMap((message) => sync().data.part[message.id] ?? [])
          .findLast((part) => part.type === "tool")
        const status = sync().data.session_status[session.id]?.type
        const waiting =
          (sync().data.permission[session.id]?.length ?? 0) + (sync().data.question[session.id]?.length ?? 0) > 0
        return {
          session,
          status: waiting
            ? "waiting"
            : status === "retry"
              ? "retry"
              : status === "busy"
                ? "running"
                : last?.error
                  ? "failed"
                  : "idle",
          model: last
            ? [providers.all().get(last.providerID)?.models[last.modelID]?.name ?? last.modelID, last.variant]
                .filter(Boolean)
                .join(" · ")
            : undefined,
          activity:
            tool?.type === "tool" ? ("title" in tool.state ? tool.state.title || tool.tool : tool.tool) : undefined,
        }
      })
      .sort(
        (a, b) =>
          Number(b.status === "running" || b.status === "waiting") -
            Number(a.status === "running" || a.status === "waiting") || a.session.time.created - b.session.time.created,
      ),
  )
  createEffect(() => {
    const current = server().session
    const ids = (agents.error ? [] : (agents.latest ?? [])).map((session) => session.id)
    ids.forEach((id) => current.pin(id))
    onCleanup(() => ids.forEach((id) => current.unpin(id)))
  })

  return (
    <ScrollView class="h-full" viewportClass="flex flex-col p-4" data-component="session-agents">
      <div class="flex items-center justify-between gap-3 mb-4">
        <h2 class="text-14-medium text-text-strong">{language.t("session.panel.agents")}</h2>
        <Button variant="ghost" size="small" onClick={() => refetch()} disabled={agents.loading}>
          {language.t("session.panel.refresh")}
        </Button>
      </div>
      <Show when={agents.error}>
        <div role="alert" class="text-13-regular text-text-weak mb-4">
          {language.t("session.agents.error")}
        </div>
      </Show>
      <Show
        when={rows().length}
        fallback={
          <Show when={!agents.error}>
            <EmptyState
              icon={<Icon name="subagent" />}
              title={language.t(agents.loading ? "common.loading" : "session.agents.empty.title")}
              description={language.t("session.agents.empty")}
            />
          </Show>
        }
      >
        <div class="flex flex-col gap-2">
          <For each={rows()}>
            {(row) => (
              <button
                class="w-full text-left rounded-lg p-3 bg-surface-base hover:bg-surface-base-hover focus-visible:outline-2 focus-visible:outline-border-active"
                onClick={() => data.navigateToSession?.(row.session.id)}
              >
                <div class="flex items-center gap-2 text-14-medium text-text-strong">
                  <Icon name="subagent" size="small" />
                  <span class="truncate flex-1">{row.session.title}</span>
                  <span class="text-12-regular text-text-weak">
                    {language.t(`session.agents.${row.status}` as "session.agents.idle")}
                  </span>
                </div>
                <Show when={row.model}>
                  <div class="text-12-regular text-text-weak mt-2 truncate">{row.model}</div>
                </Show>
                <Show when={row.activity}>
                  <div class="text-12-regular text-text-weak mt-1 truncate">{row.activity}</div>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </ScrollView>
  )
}
