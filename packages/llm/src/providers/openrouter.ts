import { Effect, Schema } from "effect"
import { Route, type RouteDefaultsInput } from "../route/client"
import { Endpoint } from "../route/endpoint"
import { Framing } from "../route/framing"
import { Protocol } from "../route/protocol"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options"
import { ProviderID, type ModelID, type ProviderOptions } from "../schema"
import * as OpenAICompatibleProfiles from "./openai-compatible-profile"
import * as OpenAIChat from "../protocols/openai-chat"
import { isRecord } from "../protocols/shared"

export const profile = OpenAICompatibleProfiles.profiles.openrouter
export const id = ProviderID.make(profile.provider)
const ADAPTER = "openrouter"

export interface OpenRouterOptions {
  readonly [key: string]: unknown
  readonly usage?: boolean | Record<string, unknown>
  readonly reasoning?: Record<string, unknown>
  readonly promptCacheKey?: string
}

export type OpenRouterProviderOptionsInput = ProviderOptions & {
  readonly openrouter?: OpenRouterOptions
}

export type ModelOptions = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: OpenRouterProviderOptionsInput
  }

const OpenRouterBody = Schema.StructWithRest(Schema.Struct({
  ...OpenAIChat.bodyFields,
  messages: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
  tools: Schema.optional(Schema.Array(Schema.Record(Schema.String, Schema.Unknown))),
}), [
  Schema.Record(Schema.String, Schema.Unknown),
])
export type OpenRouterBody = Schema.Schema.Type<typeof OpenRouterBody>

export const protocol = Protocol.make({
  id: "openrouter-chat",
  body: {
    schema: OpenRouterBody,
    from: (request) =>
      OpenAIChat.protocol.body.from(request).pipe(
        Effect.map(
          (body) =>
            ({
              ...body,
              ...(request.model.id.startsWith("anthropic/") ? {
                messages: body.messages.map((message, index) => {
                  const hint = message.role === "system" && index === body.messages.findLastIndex((item) => item.role === "system")
                    ? request.system.at(-1)?.cache
                    : message.role === "user" && index === body.messages.findLastIndex((item) => item.role === "user")
                      ? request.messages.findLast((item) => item.role === "user")?.content.flatMap((part) => "cache" in part && part.cache ? [part.cache] : []).at(-1)
                      : undefined
                  if (!hint || typeof message.content !== "string") return message
                  return { ...message, content: [{ type: "text", text: message.content, cache_control: { type: "ephemeral", ...(hint.ttlSeconds === 3600 ? { ttl: "1h" } : {}) } }] }
                }),
                tools: body.tools?.map((tool, index) => request.tools[index]?.cache ? { ...tool, cache_control: { type: "ephemeral", ...(request.tools[index]?.cache?.ttlSeconds === 3600 ? { ttl: "1h" } : {}) } } : tool),
              } : {}),
              ...bodyOptions(request.providerOptions?.openrouter),
            }) as OpenRouterBody,
        ),
      ),
  },
  stream: OpenAIChat.protocol.stream,
})

const bodyOptions = (input: unknown) => {
  const openrouter = isRecord(input) ? input : {}
  return {
    ...(openrouter.usage === true
      ? { usage: { include: true } }
      : isRecord(openrouter.usage)
        ? { usage: openrouter.usage }
        : {}),
    ...(isRecord(openrouter.reasoning) ? { reasoning: openrouter.reasoning } : {}),
    ...(typeof openrouter.promptCacheKey === "string" ? { prompt_cache_key: openrouter.promptCacheKey } : {}),
  }
}

export const route = Route.make({
  id: ADAPTER,
  provider: profile.provider,
  protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL: profile.baseURL }),
  framing: Framing.sse,
})

export const routes = [route]

const configuredRoute = (input: ModelOptions) => {
  const { apiKey: _, auth: _auth, baseURL, ...rest } = input
  return route.with({
    ...rest,
    endpoint: { baseURL: baseURL ?? profile.baseURL },
    auth: AuthOptions.bearer(input, "OPENROUTER_API_KEY"),
  })
}

export const configure = (input: ModelOptions = {}) => {
  const route = configuredRoute(input)
  return {
    id,
    model: (modelID: string | ModelID) => route.model({ id: modelID }),
    configure,
  }
}

export const provider = configure()
export const model = provider.model
export * as OpenRouter from "./openrouter"
