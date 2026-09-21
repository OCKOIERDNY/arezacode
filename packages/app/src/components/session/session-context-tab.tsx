import { createMemo, createEffect, createResource, createSignal, on, onCleanup, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useSync } from "@/context/sync"
import { checksum } from "@opencode-ai/core/util/encode"
import { findLast } from "@opencode-ai/core/util/array"
import { same } from "@/utils/same"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"
import { Accordion } from "@opencode-ai/ui/accordion"
import { StickyAccordionHeader } from "@opencode-ai/ui/sticky-accordion-header"
import { File } from "@opencode-ai/session-ui/file"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import type { Message, Part, UserMessage } from "@opencode-ai/sdk/v2/client"
import { showToast } from "@/utils/toast"
import { downloadSessionExport, fetchSessionExport, sessionExportFilename } from "@/utils/session-export"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { useSessionLayout } from "@/pages/session/session-layout"
import { getSessionContext, usageTotal } from "./session-context-metrics"
import { estimateSessionContextBreakdown, type SessionContextBreakdownKey } from "./session-context-breakdown"
import { createSessionContextFormatter } from "./session-context-format"

const BREAKDOWN_COLOR: Record<SessionContextBreakdownKey, string> = {
  system: "var(--syntax-info)",
  user: "var(--syntax-success)",
  assistant: "var(--syntax-property)",
  tool: "var(--syntax-warning)",
  other: "var(--syntax-comment)",
}

function Stat(props: { label: string; value: JSX.Element }) {
  return (
    <div class="flex flex-col gap-1">
      <div class="text-12-regular text-text-weak">{props.label}</div>
      <div class="text-12-medium text-text-strong [overflow-wrap:anywhere]">{props.value}</div>
    </div>
  )
}

function RawMessageContent(props: { message: Message; getParts: (id: string) => Part[]; onRendered: () => void }) {
  const file = createMemo(() => {
    const parts = props.getParts(props.message.id)
    const contents = JSON.stringify({ message: props.message, parts }, null, 2)
    return {
      name: `${props.message.role}-${props.message.id}.json`,
      contents,
      cacheKey: checksum(contents),
    }
  })

  return (
    <File
      mode="text"
      file={file()}
      overflow="wrap"
      class="select-text"
      onRendered={() => requestAnimationFrame(props.onRendered)}
    />
  )
}

function RawMessage(props: {
  message: Message
  getParts: (id: string) => Part[]
  onRendered: () => void
  time: (value: number | undefined) => string
}) {
  return (
    <Accordion.Item value={props.message.id}>
      <StickyAccordionHeader>
        <Accordion.Trigger>
          <div class="flex items-center justify-between gap-2 w-full">
            <div class="min-w-0 truncate">
              {props.message.role} <span class="text-text-base">• {props.message.id}</span>
            </div>
            <div class="flex items-center gap-3">
              <div class="shrink-0 text-12-regular text-text-weak">{props.time(props.message.time.created)}</div>
              <Icon name="chevron-grabber-vertical" size="small" class="shrink-0 text-text-weak" />
            </div>
          </div>
        </Accordion.Trigger>
      </StickyAccordionHeader>
      <Accordion.Content class="bg-background-base">
        <div class="p-3">
          <RawMessageContent message={props.message} getParts={props.getParts} onRendered={props.onRendered} />
        </div>
      </Accordion.Content>
    </Accordion.Item>
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
  const formatter = createMemo(() => createSessionContextFormatter(language.intl()))
  const usageKey = createMemo(() => params.id ? JSON.stringify([serverSDK().scope, params.id, messages().filter((message) => message.role === "assistant" && message.time.completed).at(-1)?.id ?? ""]) : false)
  const [usageResource] = createResource(
    usageKey,
    async (key) => ({ key, entries: await serverSDK().tools.sessionUsage(params.id!) }),
    { initialValue: { key: "", entries: [] } },
  )
  const activityEntries = () => usageResource.error || usageResource.latest.key !== usageKey() ? [] : usageResource.latest.entries
  const usageEntries = () => activityEntries().filter((entry) => entry.kind !== "automation")
  const modelName = (providerID: string, modelID: string, variant?: string) => [providers.all().get(providerID)?.models[modelID]?.name ?? modelID, variant].filter(Boolean).join(" · ")
  const childIDs = createMemo(() => [...new Set(messages().flatMap((message) => (sync().data.part[message.id] ?? []).flatMap((part) => {
    if (part.type !== "tool" || part.tool !== "task" || part.state.status === "pending") return []
    const id = part.state.metadata?.sessionId
    return typeof id === "string" ? [id] : []
  })))])
  const childKey = createMemo(() => JSON.stringify([usageKey(), childIDs()]))
  const [childActivity] = createResource(childKey, async (key) => {
    const sessions: Array<{ sessionID: string; messages: { info: Message; parts: Part[] }[] }> = []
    const visited = new Set<string>()
    const pending = new Set([...(params.id ? [params.id] : []), ...childIDs()])
    const client = sdk().client
    while (pending.size) {
      const ids = [...pending].filter((id) => !visited.has(id))
      pending.clear()
      ids.forEach((id) => visited.add(id))
      const loaded = await Promise.all(ids.map(async (sessionID) => {
        const response = await client.session.messages({ sessionID })
        if (!response.data) throw new Error(language.t("context.activity.childrenError"))
        return { sessionID, messages: response.data }
      }))
      sessions.push(...loaded)
      loaded.forEach((session) => session.messages.forEach((message) => message.parts.forEach((part) => {
        if (part.type !== "tool" || part.tool !== "task" || part.state.status === "pending") return
        const id = part.state.metadata?.sessionId
        if (typeof id === "string" && !visited.has(id)) pending.add(id)
      })))
    }
    return { key, sessions }
  }, { initialValue: { key: "", sessions: [] } })
  const history = () => childActivity.error || childActivity.latest.key !== childKey() ? [] : childActivity.latest.sessions
  const children = () => history().filter((session) => session.sessionID !== params.id)
  const tools = createMemo(() => [
    ...new Map([
      ...(history().find((session) => session.sessionID === params.id)?.messages ?? []),
      ...messages().map((info) => ({ info, parts: sync().data.part[info.id] ?? [] })),
    ].map((message) => [message.info.id, { ...message, child: false }])).values(),
    ...children().flatMap((session) => session.messages.map((message) => ({ ...message, child: true }))),
  ].flatMap((message) => {
    const info = message.info
    return info.role !== "assistant" ? [] : message.parts.flatMap((part) => part.type !== "tool" ? [] : [{
      part, child: message.child, sessionID: info.sessionID,
      model: modelName(info.providerID, info.modelID, info.variant),
      start: part.state.status === "pending" ? info.time.created : part.state.time.start,
    }])
  }).sort((a, b) => a.start - b.start))
  const [usageLimit, setUsageLimit] = createSignal(50)
  const money = (value: number | undefined) => value === undefined ? "—" : new Intl.NumberFormat(language.intl(), { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(value)
  const usageKeys = ["input", "uncachedInput", "cacheRead", "cacheWrite", "output", "reasoning", "total"] as const
  const usageValue = (entries: ReturnType<typeof usageEntries>, key: typeof usageKeys[number]) => {
    const total = usageTotal(entries, key)
    const value = formatter().number(total.value)
    return total.missing && total.value !== undefined ? language.t("context.accounting.partial", { value, count: total.missing }) : value
  }
  const modelKey = (entry: ReturnType<typeof usageEntries>[number]) => `${entry.model.providerID}/${entry.model.id}${entry.model.variant ? ` · ${entry.model.variant}` : ""}`
  const models = createMemo(() => [...new Set(usageEntries().map(modelKey))].map((model) => ({ model, entries: usageEntries().filter((entry) => modelKey(entry) === model) })))
  const prompts = createMemo(() => [...new Set(usageEntries().flatMap((entry) => entry.promptID ? [entry.promptID] : []))].slice(-usageLimit()).map((id) => ({ model: `${language.t("context.accounting.prompt")} ${id}`, entries: usageEntries().filter((entry) => entry.promptID === id) })))

  const cost = createMemo(() => {
    return money(usageTotal(usageEntries(), "cost").value)
  })

  const counts = createMemo(() => {
    const all = messages()
    const user = all.reduce((count, x) => count + (x.role === "user" ? 1 : 0), 0)
    const assistant = all.reduce((count, x) => count + (x.role === "assistant" ? 1 : 0), 0)
    return {
      all: all.length,
      user,
      assistant,
    }
  })

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
    { label: "context.stats.messages", value: () => counts().all.toLocaleString(language.intl()) },
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
    { label: "context.stats.userMessages", value: () => counts().user.toLocaleString(language.intl()) },
    { label: "context.stats.assistantMessages", value: () => counts().assistant.toLocaleString(language.intl()) },
    { label: "context.stats.totalCost", value: cost },
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
  const getParts = (id: string) => (sync().data.part[id] ?? []) as Part[]

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
      <div class="px-6 pt-4 pb-10 flex flex-col gap-10">
        <section class="flex flex-col gap-3" data-testid="session-model-activity">
          <div class="text-14-medium text-text-strong">{language.t("context.activity.title")}</div>
          <Stat label={language.t("context.activity.orchestrator")} value={[...new Set(usageEntries().filter((entry) => entry.kind !== "jev").map((entry) => modelName(entry.model.providerID, entry.model.id, entry.model.variant)))].join(", ") || modelLabel()} />
          <Show when={children().length}><Stat label={language.t("context.activity.subagent")} value={[...new Set(children().flatMap((session) => session.messages.flatMap(({ info }) => info.role === "assistant" ? [modelName(info.providerID, info.modelID, info.variant)] : [])))].join(", ") || "—"} /></Show>
          <Show when={childActivity.error}><p role="alert">{language.t("context.activity.childrenError")}</p></Show>
          <details>
            <summary class="cursor-pointer text-12-medium">{language.t("context.activity.decision")} · {usageEntries().filter((entry) => entry.kind === "jev").length}</summary>
            <ScrollView class="max-h-80 mt-2" data-testid="jev-decision-history">
              <div class="flex flex-col gap-3 pr-3">
                <For each={usageEntries().filter((entry) => entry.kind === "jev")}>{(entry) => <div class="text-12-regular text-text-weak">
                  <div>{formatter().time(entry.time.created)} · {entry.decision?.purpose ?? "Jev"} · {entry.decision?.outcome ?? entry.finish}</div>
                  <Show when={entry.decision?.selected}>{(selected) => <div class="text-text-strong">{modelName(selected().providerID, selected().id, selected().variant)} · {Math.round((entry.decision?.confidence ?? 0) * 100)}%</div>}</Show>
                  <Show when={entry.decision?.skills?.length}><div>{entry.decision?.skills?.join(", ")}</div></Show>
                </div>}</For>
              </div>
            </ScrollView>
          </details>
          <details>
            <summary class="cursor-pointer text-12-medium">{language.t("context.activity.compression")} · {activityEntries().filter((entry) => entry.automation).length}</summary>
            <ScrollView class="max-h-64 mt-2"><div class="flex flex-col gap-3 pr-3">
              <Show when={activityEntries().some((entry) => entry.automation)} fallback={<p class="text-12-regular text-text-weak">{language.t("context.activity.noHistory")}</p>}>
                <For each={activityEntries().filter((entry) => entry.automation)}>{(entry) => <div class="text-12-regular text-text-weak">
                  <div>{formatter().time(entry.time.created)} · {entry.finish}</div>
                  <div>{language.t("context.activity.characters", { input: entry.automation!.inputCharacters, output: entry.automation!.outputCharacters, saved: entry.automation!.inputCharacters - entry.automation!.outputCharacters })}</div>
                  <Show when={entry.automation!.cached}>{language.t("context.activity.cached")}</Show>
                </div>}</For>
              </Show>
            </div></ScrollView>
          </details>
          <ScrollView class="max-h-96" data-testid="session-tool-activity"><div class="flex flex-col gap-2 pr-3">
            <Show when={tools().length > usageLimit()}><Button size="small" variant="ghost" onClick={() => setUsageLimit((limit) => limit + 50)}>{language.t("context.activity.older")}</Button></Show>
            <For each={tools().slice(-usageLimit())}>{(item) => <details class="text-12-regular">
              <summary class="cursor-pointer text-text-weak">{formatter().time(item.start)} · {item.part.tool} · {item.model} · {item.part.state.status}{item.child ? ` · ${language.t("context.activity.subagent")}` : ""}</summary>
              <div class="py-2 text-text-weak break-all">{item.part.callID} · {item.sessionID}<Show when={item.part.state.status === "completed" || item.part.state.status === "error"}>{" · "}{formatter().time((item.part.state as { time: { end: number } }).time.end)}</Show></div>
              <pre class="whitespace-pre-wrap break-all text-12-regular">{JSON.stringify(item.part.state.input, null, 2)}</pre>
            </details>}</For>
          </div></ScrollView>
        </section>
        <section class="flex flex-col gap-4" data-testid="session-usage-accounting" aria-busy={usageResource.loading}>
          <div class="text-14-medium text-text-strong">{language.t("context.accounting.title")}</div>
          <p class="text-12-regular text-text-weak">{language.t("context.accounting.note")}</p>
          <p class="text-12-regular text-text-weak">{language.t("context.accounting.cacheNote")}</p>
          <Show when={usageResource.error}><p role="alert" class="text-12-regular text-text-weak">{language.t("context.accounting.error")}</p></Show>
          <div class="grid grid-cols-2 @[32rem]:grid-cols-3 gap-4">
            <Stat label={language.t("context.accounting.requests")} value={usageResource.loading ? "—" : usageEntries().length} />
            <For each={usageKeys}>{(key) => <Stat label={language.t(`context.accounting.${key}`)} value={usageValue(usageEntries(), key)} />}</For>
            <Stat label={language.t("context.accounting.reported")} value={money(usageTotal(usageEntries(), "cost", "reported").value)} />
            <Stat label={language.t("context.accounting.estimated")} value={money(usageTotal(usageEntries(), "cost", "estimated").value)} />
            <Stat label={language.t("context.accounting.unknown")} value={usageTotal(usageEntries(), "cost").missing} />
          </div>
          <For each={[...models(), ...prompts()]}>{(group) => { const [open, setOpen] = createSignal(false); return <details class="rounded-md border border-border-base p-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
            <summary class="cursor-pointer text-12-medium text-text-strong">{group.model} · {group.entries.length} {language.t("context.accounting.requests")}</summary>
            <Show when={open()}><div class="grid grid-cols-2 gap-3 pt-3">
              <For each={usageKeys}>{(key) => <Stat label={language.t(`context.accounting.${key}`)} value={usageValue(group.entries, key)} />}</For>
              <Stat label={language.t("context.accounting.reported")} value={money(usageTotal(group.entries, "cost", "reported").value)} />
              <Stat label={language.t("context.accounting.estimated")} value={money(usageTotal(group.entries, "cost", "estimated").value)} />
            </div></Show>
          </details> }}</For>
          <div class="text-12-medium text-text-strong">{language.t("context.accounting.attempts")}</div>
          <Show when={usageEntries().length > usageLimit()}><Button size="small" variant="ghost" onClick={() => setUsageLimit((limit) => limit + 50)}>{language.t("context.accounting.older")}</Button></Show>
          <For each={usageEntries().slice(-usageLimit())}>{(entry, index) => { const [open, setOpen] = createSignal(false); return <details class="rounded-md border border-border-base p-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
            <summary class="cursor-pointer text-12-regular text-text-base">{index() + 1}. {modelName(entry.model.providerID, entry.model.id, entry.model.variant)} · {formatter().time(entry.time.created)} · {money(entry.usage?.cost)}</summary>
            <Show when={open()}><div class="grid grid-cols-2 gap-3 pt-3">
              <Stat label={language.t("context.accounting.request")} value={entry.id} />
              <Stat label={language.t("context.accounting.responseID")} value={entry.usage?.responseID ?? "—"} />
              <Stat label={language.t("context.accounting.actualModel")} value={entry.usage?.responseModel ?? entry.model.id} />
              <Stat label={language.t("context.accounting.actualProvider")} value={entry.usage?.responseProvider ?? "—"} />
              <Stat label={language.t("context.accounting.prompt")} value={entry.promptID ?? "—"} />
              <For each={usageKeys}>{(key) => <Stat label={language.t(`context.accounting.${key}`)} value={usageValue([entry], key)} />}</For>
              <Stat label={language.t("context.accounting.source")} value={language.t(`context.accounting.${entry.usage?.costSource ?? "unknown"}`)} />
              <Stat label={language.t("context.accounting.upstream")} value={money(entry.usage?.upstreamCost)} />
              <Stat label={language.t("context.accounting.finish")} value={entry.finish ?? "—"} />
              <Stat label={language.t("context.accounting.version")} value={entry.usage?.version ?? "—"} />
            </div>
            <Show when={entry.usage?.prices}>{(prices) => <div class="pt-3 text-12-regular text-text-weak">{language.t("context.accounting.prices", { input: prices().input, output: prices().output, read: prices().cache.read, write: prices().cache.write })}</div>}</Show>
            <Show when={entry.usage?.request}>{(request) => <div class="pt-3 text-12-regular text-text-weak">{language.t("context.accounting.characters", { system: request().systemCharacters, messages: request().messageCharacters, tools: request().toolCharacters })}</div>}</Show>
            </Show>
          </details> }}</For>
        </section>
        <div class="grid grid-cols-1 @[32rem]:grid-cols-2 gap-4">
          <For each={stats}>
            {(stat) => <Stat label={language.t(stat.label as Parameters<typeof language.t>[0])} value={stat.value()} />}
          </For>
        </div>

        <Show when={breakdown().length > 0}>
          <div class="flex flex-col gap-2">
            <div class="text-12-regular text-text-weak">{language.t("context.breakdown.title")}</div>
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
            <div class="text-11-regular text-text-weaker">{language.t("context.breakdown.note")}</div>
          </div>
        </Show>

        <Show when={systemPrompt()}>
          {(prompt) => (
            <div class="flex flex-col gap-2">
              <div class="text-12-regular text-text-weak">{language.t("context.systemPrompt.title")}</div>
              <div class="border border-border-base rounded-md bg-surface-base px-3 py-2">
                <Markdown text={prompt()} class="text-12-regular" />
              </div>
            </div>
          )}
        </Show>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <div class="text-12-regular text-text-weak">{language.t("context.rawMessages.title")}</div>
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
          <Accordion multiple>
            <For each={messages()}>
              {(message) => (
                <RawMessage message={message} getParts={getParts} onRendered={restoreScroll} time={formatter().time} />
              )}
            </For>
          </Accordion>
        </div>
      </div>
    </ScrollView>
  )
}
