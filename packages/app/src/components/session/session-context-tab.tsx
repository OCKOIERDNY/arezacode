import { createMemo, createEffect, createResource, on, onCleanup, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useSync } from "@/context/sync"
import { findLast } from "@opencode-ai/core/util/array"
import { same } from "@/utils/same"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import type { Message, Part, UserMessage } from "@opencode-ai/sdk/v2/client"
import { showToast } from "@/utils/toast"
import { downloadSessionExport, fetchSessionExport, sessionExportFilename } from "@/utils/session-export"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { useSessionLayout } from "@/pages/session/session-layout"
import { getSessionContext, responsePerformance } from "./session-context-metrics"
import { loadContextUsage } from "./session-context-data"
import { SessionContextDashboard } from "./session-context-dashboard"
import { estimateSessionContextBreakdown, type SessionContextBreakdownKey } from "./session-context-breakdown"
import { createSessionContextFormatter } from "./session-context-format"
import { SessionContextHelp } from "./session-context-help"
import { useSessionHealth } from "@/hooks/use-session-health"

const BREAKDOWN_COLOR: Record<SessionContextBreakdownKey, string> = {
  system: "var(--syntax-info)",
  user: "var(--syntax-success)",
  assistant: "var(--syntax-property)",
  tool: "var(--syntax-warning)",
  other: "var(--syntax-comment)",
}

function Stat(props: { label: string; value: JSX.Element }) {
  return (
    <div class="flex items-baseline justify-between gap-4">
      <div class="text-12-regular text-text-weak">{props.label}</div>
      <div class="min-w-0 text-end tabular-nums text-12-medium text-text-strong [overflow-wrap:anywhere]">{props.value}</div>
    </div>
  )
}

const emptyMessages: Message[] = []
const emptyUserMessages: UserMessage[] = []

export function SessionContextTab() {
  const sync = useSync()
  const language = useLanguage()
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  const providers = useProviders(() => sdk().directory)
  const { params, view } = useSessionLayout()
  const health = useSessionHealth(() => params.id)
  const [inspection, setInspection] = createStore({ system: false, messages: false, message: "" })
  const workingUsage = createMemo(() => {
    const data = health.query.data
    if (data?.inputTokens === undefined || !data.limit) return
    return Math.round(data.inputTokens / data.limit * 100)
  })

  const info = createMemo(() => (params.id ? sync().session.get(params.id) : undefined))

  const messages = createMemo(
    () => {
      const id = params.id
      if (!id) return emptyMessages
      return (sync().data.message[id] ?? []) as Message[]
    },
    emptyMessages,
    { equals: same },
  )

  const userMessages = createMemo(
    () => messages().filter((m) => m.role === "user") as UserMessage[],
    emptyUserMessages,
    { equals: same },
  )

  const visibleUserMessages = createMemo(
    () => {
      const revert = info()?.revert?.messageID
      if (!revert) return userMessages()
      const boundary = userMessages().findIndex((message) => message.id === revert)
      return boundary < 0 ? userMessages() : userMessages().slice(0, boundary)
    },
    emptyUserMessages,
    { equals: same },
  )

  const ctx = createMemo(() => getSessionContext(messages(), [...providers.all().values()]))
  const performance = createMemo(() => responsePerformance(messages(), sync().data.part))
  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))
  const usageKey = createMemo(() => {
    if (!params.id) return false
    const last = messages().at(-1)
    return JSON.stringify([serverSDK().scope, params.id, last?.id, last?.role === "assistant" ? last.time.completed : last?.model, sync().data.session_status[params.id]?.type])
  })
  const [usageResource] = createResource(
    usageKey,
    async (key) => {
      const client = serverSDK()
      const sessionID = params.id
      return { key, entries: sessionID ? await loadContextUsage({ sessionID, session: client.api.session, usage: client.tools.sessionUsage }) : [] }
    },
    { initialValue: { key: "", entries: [] } },
  )
  const activityEntries = () => usageResource.error || usageResource.latest.key !== usageKey() ? [] : usageResource.latest.entries
  const modelName = (providerID: string, modelID: string, variant?: string) => [providers.all().get(providerID)?.models[modelID]?.name ?? modelID, variant].filter(Boolean).join(" · ")

  const systemPrompt = createMemo(() => {
    const msg = findLast(visibleUserMessages(), (m) => !!m.system)
    const system = msg?.system
    if (!system) return
    const trimmed = system.trim()
    if (!trimmed) return
    return trimmed
  })

  const providerLabel = createMemo(() => {
    const c = ctx()
    if (!c) return "—"
    return c.providerLabel
  })

  const modelLabel = createMemo(() => {
    const c = ctx()
    if (!c) return "—"
    return c.modelLabel
  })

  const breakdown = createMemo(
    on(
      () => [ctx()?.message.id, ctx()?.input, messages().length, systemPrompt()],
      () => {
        const c = ctx()
        if (!c?.input) return []
        return estimateSessionContextBreakdown({
          messages: messages(),
          parts: sync().data.part as Record<string, Part[] | undefined>,
          input: c.input,
          systemPrompt: systemPrompt(),
        })
      },
    ),
  )

  const breakdownLabel = (key: SessionContextBreakdownKey) => {
    if (key === "system") return language.t("context.breakdown.system")
    if (key === "user") return language.t("context.breakdown.user")
    if (key === "assistant") return language.t("context.breakdown.assistant")
    if (key === "tool") return language.t("context.breakdown.tool")
    return language.t("context.breakdown.other")
  }

  const stats = [
    { label: "context.stats.session", value: () => info()?.title ?? params.id ?? "—" },
    { label: "context.stats.messages", value: () => formatter().number(messages().length) },
    { label: "context.stats.userMessages", value: () => formatter().number(userMessages().length) },
    { label: "context.stats.assistantMessages", value: () => formatter().number(messages().length - userMessages().length) },
    { label: "context.stats.provider", value: providerLabel },
    { label: "context.stats.model", value: modelLabel },
    { label: "context.stats.limit", value: () => formatter().number(ctx()?.limit) },
    { label: "context.stats.totalTokens", value: () => formatter().number(ctx()?.total) },
    { label: "context.stats.usage", value: () => formatter().percent(ctx()?.usage) },
    { label: "context.stats.inputTokens", value: () => formatter().number(ctx()?.input) },
    { label: "context.stats.outputTokens", value: () => formatter().number(ctx()?.message.tokens.output) },
    { label: "context.stats.reasoningTokens", value: () => formatter().number(ctx()?.message.tokens.reasoning) },
    {
      label: "context.stats.cacheTokens",
      value: () =>
        `${formatter().number(ctx()?.message.tokens.cache.read)} / ${formatter().number(ctx()?.message.tokens.cache.write)}`,
    },
    { label: "context.stats.sessionCreated", value: () => formatter().time(info()?.time.created) },
    { label: "context.stats.lastActivity", value: () => formatter().time(ctx()?.message.time.created) },
  ] satisfies { label: string; value: () => JSX.Element }[]

  const exportSession = async () => {
    const sessionID = params.id
    if (!sessionID) return
    try {
      const data = await fetchSessionExport({
        sessionID,
        client: sdk().client,
      })
      const filename = sessionExportFilename(data.info)
      downloadSessionExport(filename, data)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("toast.session.export.success.title"),
        description: language.t("toast.session.export.success.description", { filename }),
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("toast.session.export.failed.title"),
        description: err instanceof Error ? err.message : language.t("toast.session.export.failed.description"),
      })
    }
  }

  let scroll: HTMLDivElement | undefined
  let frame: number | undefined
  let pending: { x: number; y: number } | undefined

  const restoreScroll = () => {
    const el = scroll
    if (!el) return

    const s = view().scroll("context")
    if (!s) return

    if (el.scrollTop !== s.y) el.scrollTop = s.y
    if (el.scrollLeft !== s.x) el.scrollLeft = s.x
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    pending = {
      x: event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    }
    if (frame !== undefined) return

    frame = requestAnimationFrame(() => {
      frame = undefined

      const next = pending
      pending = undefined
      if (!next) return

      view().setScroll("context", next)
    })
  }

  createEffect(
    on(
      () => messages().length,
      () => {
        requestAnimationFrame(restoreScroll)
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
  })

  return (
    <ScrollView
      class="@container h-full"
      viewportRef={(el) => {
        scroll = el
        restoreScroll()
      }}
      onScroll={handleScroll}
    >
      <div class="px-4 pt-4 pb-8 flex flex-col gap-6">
        <section class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-14-medium text-text-strong">{language.t("context.dashboard.workingContext")}</h2>
            <SessionContextHelp label={language.t("context.dashboard.workingContext")} text={language.t("context.dashboard.workingNote")} />
          </div>
          <div class="flex items-baseline justify-between gap-3">
            <span class="text-12-regular text-text-weak">{health.query.isSuccess ? language.t(`context.health.${health.state()}`) : "—"}</span>
            <span class="text-20-medium tabular-nums text-text-strong">{workingUsage() === undefined ? "—" : `${workingUsage()}%`}</span>
          </div>
          <div class="h-1.5 overflow-hidden rounded-full bg-surface-base" role="progressbar" aria-label={language.t("context.dashboard.workingContext")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={workingUsage() === undefined ? undefined : Math.min(100, workingUsage()!)}>
            <div class="h-full rounded-full" classList={{ "bg-icon-warning-base": health.state() !== "healthy", "bg-icon-base": health.state() === "healthy" }} style={{ width: `${Math.min(100, workingUsage() ?? 0)}%` }} />
          </div>
          <Stat label={language.t("context.health.input")} value={formatter().number(health.query.data?.inputTokens)} />
          <Stat label={language.t("context.health.limit")} value={formatter().number(health.query.data?.limit)} />
          <Stat label={language.t("context.stats.model")} value={<bdi>{modelLabel()}</bdi>} />
          <Stat label={language.t("context.stats.provider")} value={<bdi>{providerLabel()}</bdi>} />
        </section>
        <details>
          <summary class="cursor-pointer text-12-medium text-text-strong">{language.t("context.dashboard.sessionDetails")}</summary>
          <div class="flex flex-col gap-2 pt-3">
            <For each={stats}>
              {(stat) => <Stat label={language.t(stat.label as Parameters<typeof language.t>[0])} value={stat.value()} />}
            </For>
          </div>
        </details>

        <Show when={breakdown().length > 0}>
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-2 text-12-regular text-text-weak">
              {language.t("context.breakdown.title")}
              <SessionContextHelp label={language.t("context.breakdown.title")} text={language.t("context.breakdown.note")} />
            </div>
            <div class="h-2 w-full rounded-full bg-surface-base overflow-hidden flex">
              <For each={breakdown()}>
                {(segment) => (
                  <div
                    class="h-full"
                    style={{
                      width: `${segment.width}%`,
                      "background-color": BREAKDOWN_COLOR[segment.key],
                    }}
                  />
                )}
              </For>
            </div>
            <div class="flex flex-wrap gap-x-3 gap-y-1">
              <For each={breakdown()}>
                {(segment) => (
                  <div class="flex items-center gap-1 text-11-regular text-text-weak">
                    <div class="size-2 rounded-sm" style={{ "background-color": BREAKDOWN_COLOR[segment.key] }} />
                    <div>{breakdownLabel(segment.key)}</div>
                    <div class="text-text-weaker">{segment.percent.toLocaleString(language.intl())}%</div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        <SessionContextDashboard entries={activityEntries()} loading={usageResource.loading} error={!!usageResource.error} modelName={modelName} />

        <Show when={performance()}>{(time) => (
          <details>
            <summary class="cursor-pointer text-12-medium text-text-strong">{language.t("context.timing.title")}</summary>
            <div class="flex justify-end">
              <SessionContextHelp label={language.t("context.timing.title")} text={language.t("context.health.elapsedNote")} />
            </div>
            <div class="flex flex-col gap-2">
              <For each={["last", "recent", "previous", "tools", "checks", "wait", "other"] as const}>{(key) => (
                <Stat label={language.t(`context.health.timing.${key}`)} value={formatter().duration(time()[key])} />
              )}</For>
            </div>
          </details>
        )}</Show>

        <Show when={systemPrompt()}>{(prompt) => (
          <details onToggle={(event) => setInspection("system", event.currentTarget.open)}>
            <summary class="cursor-pointer text-12-medium text-text-strong">{language.t("context.systemPrompt.title")}</summary>
            <Show when={inspection.system}>
              <pre dir="auto" class="pt-3 whitespace-pre-wrap break-words text-12-regular text-text-weak">{prompt()}</pre>
            </Show>
          </details>
        )}</Show>

        <details onToggle={(event) => setInspection("messages", event.currentTarget.open)}>
          <summary class="cursor-pointer text-12-medium text-text-strong">{language.t("context.rawMessages.title")} · {formatter().number(messages().length)}</summary>
          <Show when={inspection.messages}>
            <div class="flex flex-col gap-2 pt-3">
              <For each={messages()}>{(message) => (
                <details open={inspection.message === message.id} onToggle={(event) => {
                  if (event.currentTarget.open) setInspection("message", message.id)
                  if (!event.currentTarget.open && inspection.message === message.id) setInspection("message", "")
                }}>
                  <summary class="cursor-pointer text-12-regular text-text-weak">
                    {language.t(message.role === "user" ? "context.breakdown.user" : "context.breakdown.assistant")} · {formatter().time(message.time.created)}
                  </summary>
                  <Show when={inspection.message === message.id}>
                    <pre dir="ltr" class="max-h-96 overflow-auto whitespace-pre-wrap break-all py-2 text-12-regular text-text-weak">{JSON.stringify({ message, parts: sync().data.part[message.id] ?? [] }, null, 2)}</pre>
                  </Show>
                </details>
              )}</For>
            </div>
          </Show>
        </details>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <div class="text-12-regular text-text-weak">{language.t("context.dashboard.diagnostics")}</div>
            <Button
              size="small"
              variant="ghost"
              class="gap-1.5 px-2 text-text-weak hover:text-text-base"
              onClick={exportSession}
            >
              <Icon name="download" size="small" />
              <span>{language.t("context.export.session")}</span>
            </Button>
          </div>
        </div>
      </div>
    </ScrollView>
  )
}
