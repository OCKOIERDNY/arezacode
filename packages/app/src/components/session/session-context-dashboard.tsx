import { createMemo, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { modelUsage, usageCacheRate, usageTotal } from "./session-context-metrics"
import { createSessionContextFormatter } from "./session-context-format"
import type { ContextUsageEntry } from "./session-context-data"

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
  const total = (key: "input" | "output" | "total" | "cacheRead" | "cacheWrite") => {
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
      { label: "context.accounting.input", value: total("input") },
      { label: "context.accounting.output", value: total("output") },
      {
        label: "context.dashboard.cacheRate",
        value: props.loading || props.error || cache().value === undefined ? "—" : `${known(cache().value)}%`,
      },
      { label: "context.stats.totalCost", value: money(usageTotal(usage(), "cost").value) },
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
      <div>
        <h2 class="text-14-medium text-text-strong">{language.t("context.dashboard.title")}</h2>
        <p class="text-12-regular text-text-weak">{language.t("context.dashboard.scope")}</p>
      </div>
      <Show when={props.error}>
        <p role="alert">{language.t("context.accounting.error")}</p>
      </Show>
      <div class="grid grid-cols-2 @[32rem]:grid-cols-3 gap-3">
        <For each={cards()}>
          {(card) => (
            <div class="rounded-md border border-border-base p-3">
              <div class="text-12-regular text-text-weak">{language.t(card.label)}</div>
              <div class="text-14-medium text-text-strong">{card.value}</div>
            </div>
          )}
        </For>
      </div>
      <p class="text-12-regular text-text-weak">{language.t("context.dashboard.definitions")}</p>
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
        <div class="overflow-x-auto">
          <table class="w-full text-12-regular text-start">
            <caption class="text-start pb-2 text-text-weak">{language.t("context.dashboard.averages")}</caption>
            <thead>
              <tr>
                <For
                  each={
                    [
                      "context.stats.model",
                      "context.dashboard.calls",
                      "context.accounting.input",
                      "context.accounting.output",
                      "context.accounting.cacheRead",
                      "context.accounting.cacheWrite",
                    ] as const
                  }
                >
                  {(key) => (
                    <th scope="col" class="text-start p-2 font-medium">
                      {language.t(key)}
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={models()}>
                {(group) => (
                  <tr class="border-t border-border-base">
                    <th scope="row" class="text-start p-2 font-normal">
                      <bdi>{props.modelName(group.model.providerID, group.model.id)}</bdi>
                      <div class="text-text-weak">
                        {language.t(
                          group.role === "main" ? "context.activity.orchestrator" : "context.activity.subagent",
                        )}
                      </div>
                      <div class="text-text-weak">
                        <For each={group.efforts}>
                          {(item) => (
                            <span class="me-2">
                              <bdi>{item.effort ?? language.t("context.dashboard.unspecified")}</bdi> · {item.count}
                            </span>
                          )}
                        </For>
                      </div>
                    </th>
                    <td class="p-2 tabular-nums">
                      {group.entries.length} · {format().number(group.share)}%
                    </td>
                    <For each={["input", "output", "cacheRead", "cacheWrite"] as const}>
                      {(key) => <td class="p-2 tabular-nums">{average(group.entries, key)}</td>}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
        <details class="rounded-md border border-border-base p-3">
          <summary class="cursor-pointer text-12-medium">
            {language.t("context.activity.decision")} · {props.entries.filter((entry) => entry.kind === "jev").length}
          </summary>
          <p class="text-12-regular text-text-weak py-2">{language.t("context.dashboard.routingNote")}</p>
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
        <div class="text-12-regular">
          <h3 class="text-12-medium">
            {language.t("context.activity.compression")} · {compression().length}
          </h3>
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
        </div>
        <Show when={timing()}>
          {(time) => (
            <div class="text-12-regular">
              <h3 class="text-12-medium">{language.t("context.dashboard.transport")}</h3>
              <p class="text-text-weak">{language.t("context.dashboard.transportNote")}</p>
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
            </div>
          )}
        </Show>
      </Show>
    </section>
  )
}
