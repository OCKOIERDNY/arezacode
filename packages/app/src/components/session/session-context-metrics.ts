import type { AssistantMessage, Message } from "@opencode-ai/sdk/v2/client"
import type { SessionMessage } from "@opencode-ai/schema/session-message"
import { sessionUsage } from "@/utils/session-message"

export function recordedUsage(message: AssistantMessage): SessionMessage.Usage | undefined {
  const usage = sessionUsage(message)
  if (usage) return usage
  const input = message.tokens.input + message.tokens.cache.read + message.tokens.cache.write
  const output = message.tokens.output + message.tokens.reasoning
  const cost = Number.isFinite(message.cost) && message.cost > 0 ? message.cost : undefined
  if (input + output === 0 && cost === undefined) return
  return {
    version: 1,
    input,
    output,
    reasoning: message.tokens.reasoning,
    cacheRead: message.tokens.cache.read,
    cacheWrite: message.tokens.cache.write,
    total: input + output,
    cost,
    costSource: "unknown",
  }
}

export function getSessionCost(messages: Message[], total?: number) {
  if (total !== undefined && Number.isFinite(total) && total > 0) return total
  return usageTotal(
    messages.flatMap((message) => message.role === "assistant" ? [{ usage: recordedUsage(message) }] : []),
    "cost",
  ).value
}

export function usageTotal(entries: readonly { usage?: SessionMessage.Usage }[], key: "input" | "uncachedInput" | "output" | "reasoning" | "cacheRead" | "cacheWrite" | "total" | "cost", source?: "reported" | "estimated") {
  const values = entries.flatMap((entry) => {
    const usage = entry.usage
    if (!usage || (source && usage.costSource !== source)) return []
    const value = key === "uncachedInput"
      ? usage.input !== undefined && usage.cacheRead !== undefined && usage.cacheRead <= usage.input
        ? usage.input - usage.cacheRead
        : undefined
      : usage[key]
    return value === undefined ? [] : [value]
  })
  return { value: values.length ? values.reduce((sum, value) => sum + value, 0) : undefined, missing: entries.length - values.length }
}

export function executionTiming(start: number, end: number, spans: { kind: "wait" | "checks" | "tools" | "routing" | "model"; start: number; end: number }[]) {
  const kinds = ["wait", "checks", "tools", "routing", "model"] as const
  const active = { wait: 0, checks: 0, tools: 0, routing: 0, model: 0 }
  const totals = { wait: 0, checks: 0, tools: 0, routing: 0, model: 0, other: 0 }
  const events = spans.flatMap((span) => {
    const from = Math.max(start, span.start)
    const to = Math.min(end, span.end)
    return Number.isFinite(from) && Number.isFinite(to) && to > from
      ? [{ time: from, kind: span.kind, delta: 1 }, { time: to, kind: span.kind, delta: -1 }]
      : []
  }).sort((a, b) => a.time - b.time)
  let previous = start
  for (const event of events) {
    totals[kinds.find((kind) => active[kind] > 0) ?? "other"] += event.time - previous
    active[event.kind] += event.delta
    previous = event.time
  }
  totals[kinds.find((kind) => active[kind] > 0) ?? "other"] += Math.max(0, end - previous)
  return totals
}

type Provider = {
  id: string
  name?: string
  models: Record<string, Model | undefined>
}

type Model = {
  name?: string
  limit: {
    context: number
  }
}

type Context = {
  message: AssistantMessage
  provider?: Provider
  model?: Model
  providerLabel: string
  modelLabel: string
  limit: number | undefined
  input: number | undefined
  total: number
  usage: number | null
}

const tokenTotal = (msg: AssistantMessage) => {
  const usage = recordedUsage(msg)
  if (usage) return usage.total ?? ((usage.input ?? 0) + (usage.output ?? 0))
  return msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write
}

const lastAssistantWithTokens = (messages: Message[]) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue
    if (tokenTotal(msg) <= 0) continue
    return msg
  }
}

const build = (messages: Message[] = [], providers: Provider[] = []): Context | undefined => {
  const message = lastAssistantWithTokens(messages)
  if (!message) return undefined

  const provider = providers.find((item) => item.id === message.providerID)
  const model = provider?.models[message.modelID]
  const limit = model?.limit.context
  const total = tokenTotal(message)

  return {
    message,
    provider,
    model,
    providerLabel: provider?.name ?? message.providerID,
    modelLabel: model?.name ?? message.modelID,
    limit,
    input: recordedUsage(message)?.input ?? message.tokens.input + message.tokens.cache.read + message.tokens.cache.write,
    total,
    usage: limit ? Math.round((total / limit) * 100) : null,
  }
}

export function getSessionContext(messages: Message[] = [], providers: Provider[] = []) {
  return build(messages, providers)
}
