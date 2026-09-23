import { createMemo, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { modelUsage, usageCacheRate, usageTotal } from "./session-context-metrics"
import { createSessionContextFormatter } from "./session-context-format"
import type { ContextUsageEntry } from "./session-context-data"
import { SessionContextHelp } from "./session-context-help"

export function SessionContextDashboard(props: {
  entries: ContextUsageEntry[]
  loading: boolean
  error: boolean
  modelName: (provider: string, model: string, variant?: string) => string
}) {
  const language = useLanguage()
  const format = createMemo(() => createSessionContextFormatter(language.intl()))
  const usage = createMemo(() => props.entries.filter((entry) => entry.kind !== "automation"))
  const models = createMemo(() => modelUsage(props.entries))
  const mostUsed = createMemo(() => models().toSorted((a, b) => b.modelCalls - a.modelCalls)[0])
  const cache = createMemo(() => usageCacheRate(usage()))
  const known = (value?: number) => (props.loading || props.error ? "—" : format().number(value))
  const money = (value?: number) =>
    value === undefined || props.loading || props.error
      ? "—"
      : new Intl.NumberFormat(language.intl(), { style: "currency", currency: "USD", maximumFractionDigits: 6 }).format(
          value,
        )
  const total = (key: "input" | "output" | "total" | "cacheRead" | "cacheWrite" | "reasoning" | "uncachedInput") => {
    const result = usageTotal(usage(), key)
    const value = known(result.value)
    return !props.loading && !props.error && result.value !== undefined && result.missing
      ? language.t("context.accounting.partial", { value, count: result.missing })
      : value
  }
  const duration = (start?: number, end?: number) =>
    format().duration(start === undefined || end === undefined ? undefined : Math.max(0, end - start))
  const average = (entries: ContextUsageEntry[], key: "input" | "output" | "cacheRead" | "cacheWrite") => {
    const total = usageTotal(entries, key)
    const value = format().number(
      total.value === undefined ? undefined : total.value / (entries.length - total.missing),
    )
    return total.missing && total.value !== undefined
      ? language.t("context.accounting.partial", { value, count: total.missing })
      : value
  }
  const decisions = createMemo(() => {
    const groups = new Map<
      string,
      { role: ContextUsageEntry["role"]; model: ContextUsageEntry["model"]; count: number }
    >()
    for (const entry of props.entries) {
      const model = entry.decision?.selected
      if (entry.kind !== "jev" || !model) continue
      const key = JSON.stringify([entry.role, model.providerID, model.id, model.variant])
      const group = groups.get(key) ?? { role: entry.role, model, count: 0 }
      group.count++
      groups.set(key, group)
    }
    return [...groups.values()].sort((a, b) => b.count - a.count)
  })
  const compression = createMemo(() => props.entries.flatMap((entry) => (entry.automation ? [entry.automation] : [])))
  const timing = createMemo(() =>
    usage()
      .flatMap((entry) => (entry.usage?.timing ? [entry.usage.timing] : []))
      .sort((a, b) => a.startedAt - b.startedAt)
      .at(-1),
  )
  const cards = () =>
    [
      { label: "context.accounting.total", value: total("total") },
      { label: "context.stats.inputTokens", value: total("input") },
      { label: "context.stats.outputTokens", value: total("output") },
      {
        label: "context.dashboard.cacheRate",
        value: props.loading || props.error || cache().value === undefined ? "—" : `${known(cache().value)}%`,
      },
      { label: "context.stats.totalCost", value: money(usageTotal(usage(), "cost").value) },
      { label: "context.stats.reasoningTokens", value: total("reasoning") },
      { label: "context.dashboard.uncached", value: total("uncachedInput") },
      { label: "context.dashboard.cacheRead", value: total("cacheRead") },
      { label: "context.dashboard.cacheWrite", value: total("cacheWrite") },
      { label: "context.accounting.reported", value: money(usageTotal(usage(), "cost", "reported").value) },
      { label: "context.accounting.estimated", value: money(usageTotal(usage(), "cost", "estimated").value) },
      { label: "context.dashboard.missingCost", value: known(usageTotal(usage(), "cost").missing) },
      {
        label: "context.dashboard.compactions",
        value: known(usage().filter((entry) => entry.kind === "compaction").length),
      },
    ] as const

  return (
    <section class="flex flex-col gap-5" aria-busy={props.loading} data-testid="session-usage-accounting">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-14-medium text-text-strong">{language.t("context.dashboard.sessionTotals")}</h2>
        <SessionContextHelp label={language.t("context.dashboard.sessionTotals")} text={`${language.t("context.dashboard.scope")} ${language.t("context.dashboard.definitions")}`} />
      </div>
      <Show when={props.error}>
        <p role="alert">{language.t("context.accounting.error")}</p>
      </Show>
      <dl class="flex flex-col gap-2">
        <For each={cards().slice(0, 5)}>
          {(card) => (
            <div class="flex items-baseline justify-between gap-4 text-12-regular">
              <dt class="text-text-weak">{language.t(card.label)}</dt>
              <dd class="text-end tabular-nums text-text-strong">{card.value}</dd>
            </div>
          )}
        </For>
      </dl>
      <details>
        <summary class="cursor-pointer text-12-medium text-text-weak">{language.t("context.dashboard.tokenDetails")}</summary>
        <dl class="flex flex-col gap-2 pt-3">
          <For each={cards().slice(5)}>{(card) => (
            <div class="flex items-baseline justify-between gap-4 text-12-regular">
              <dt class="text-text-weak">{language.t(card.label)}</dt>
              <dd class="text-end tabular-nums text-text-strong">{card.value}</dd>
            </div>
          )}</For>
        </dl>
      </details>
      <Show when={!props.loading && !props.error && !usage().length}>
        <p>{language.t("context.activity.noHistory")}</p>
      </Show>
      <Show when={!props.loading && !props.error}>
        <Show when={mostUsed()}>
          {(most) => (
            <div class="text-12-regular">
              {language.t("context.dashboard.mostUsed")} ·{" "}
              <bdi>{props.modelName(most().model.providerID, most().model.id)}</bdi>
              {" · "}
              {format().number(most().modelCalls)} · {format().number(most().modelShare)}%
            </div>
          )}
        </Show>
        <details>
          <summary class="cursor-pointer text-12-medium text-text-strong">{language.t("context.dashboard.models")}</summary>
          <div class="flex items-center justify-between gap-2 pt-2 text-12-regular text-text-weak">
            {language.t("context.dashboard.perCall")}
            <SessionContextHelp label={language.t("context.dashboard.models")} text={language.t("context.dashboard.averages")} />
          </div>
          <div class="flex flex-col gap-3 pt-2">
            <For each={models()}>{(group) => (
              <details class="text-12-regular">
                <summary class="cursor-pointer text-text-strong [overflow-wrap:anywhere]">
                  <bdi>{props.modelName(group.model.providerID, group.model.id)}</bdi>
                  <span class="ms-2 text-text-weak">{language.t(group.role === "main" ? "context.activity.orchestrator" : "context.activity.subagent")}</span>
                </summary>
                <dl class="flex flex-col gap-2 pt-3">
                  <div class="flex justify-between gap-4">
                    <dt class="text-text-weak">{language.t("context.dashboard.calls")}</dt>
                    <dd class="tabular-nums">{format().number(group.entries.length)} · {format().number(group.share)}%</dd>
                  </div>
                  <For each={["input", "output", "cacheRead", "cacheWrite"] as const}>{(key) => (
                    <div class="flex justify-between gap-4">
                      <dt class="text-text-weak">{language.t(`context.dashboard.${key}`)}</dt>
                      <dd class="text-end tabular-nums">{average(group.entries, key)}</dd>
                    </div>
                  )}</For>
                </dl>
                <div class="flex flex-wrap gap-2 pt-2 text-text-weak">
                  <For each={group.efforts}>{(item) => (
                    <span><bdi>{item.effort ?? language.t("context.dashboard.unspecified")}</bdi> · {format().number(item.count)}</span>
                  )}</For>
                </div>
              </details>
            )}</For>
          </div>
        </details>
        <details>
          <summary class="cursor-pointer text-12-medium">
            {language.t("context.activity.decision")} · {props.entries.filter((entry) => entry.kind === "jev").length}
          </summary>
          <div class="flex justify-end">
            <SessionContextHelp label={language.t("context.activity.decision")} text={language.t("context.dashboard.routingNote")} />
          </div>
          <For each={decisions()}>
            {(group) => (
              <div class="text-12-regular py-1">
                {language.t(group.role === "main" ? "context.activity.orchestrator" : "context.activity.subagent")} ·{" "}
                <bdi>{props.modelName(group.model.providerID, group.model.id, group.model.variant)}</bdi> ·{" "}
                {group.count}
              </div>
            )}
          </For>
          <div class="text-12-regular">
            {language.t("session.jev.uncertain")} ·{" "}
            {props.entries.filter((entry) => entry.kind === "jev" && entry.decision?.outcome === "uncertain").length}
          </div>
        </details>
        <details class="text-12-regular">
          <summary class="cursor-pointer text-12-medium">
            {language.t("context.activity.compression")} · {compression().length}
          </summary>
          <Show
            when={compression().length}
            fallback={<p class="text-text-weak">{language.t("context.activity.noHistory")}</p>}
          >
            <p>
              {language.t("context.activity.characters", {
                input: compression().reduce((sum, item) => sum + item.inputCharacters, 0),
                output: compression().reduce((sum, item) => sum + item.outputCharacters, 0),
                saved: compression().reduce((sum, item) => sum + item.inputCharacters - item.outputCharacters, 0),
              })}
            </p>
            <p class="text-text-weak">
              {language.t("context.activity.cached")} · {compression().filter((item) => item.cached).length}
            </p>
          </Show>
        </details>
        <Show when={timing()}>
          {(time) => (
            <details class="text-12-regular">
              <summary class="cursor-pointer text-12-medium">{language.t("context.dashboard.transport")}</summary>
              <div class="flex justify-end">
                <SessionContextHelp label={language.t("context.dashboard.transport")} text={language.t("context.dashboard.transportNote")} />
              </div>
              <div>
                {language.t("context.dashboard.dispatch")} · {duration(time().startedAt, time().dispatchedAt)}
              </div>
              <div>
                {language.t("context.dashboard.firstResponse")} ·{" "}
                {duration(time().dispatchedAt, time().firstResponseAt)}
              </div>
              <div>
                {language.t("context.dashboard.retries")} ·{" "}
                {time().dispatchedAt === undefined ? "—" : time().retries.length} ·{" "}
                {format().duration(
                  time().dispatchedAt === undefined
                    ? undefined
                    : time().retries.reduce((sum, retry) => sum + retry.delayMs, 0),
                )}
              </div>
            </details>
          )}
        </Show>
      </Show>
    </section>
  )
}
