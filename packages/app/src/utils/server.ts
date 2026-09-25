import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { OpenCode, type OpenCodeClient } from "@opencode-ai/client/promise"
import type {
  SessionsPromptOutput,
  SessionsHealthOutput,
  SessionsHandoffOutput,
  SessionsListInput,
} from "@opencode-ai/client-current"
import type { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"
import { createApprovalApi, withCurrentContract, type LegacyPrompt } from "./server-compat"

export function authTokenFromCredentials(input: { username?: string; password: string }) {
  return btoa(`${input.username ?? "opencode"}:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)
  if (!decoded) return undefined
  const separator = decoded.indexOf(":")
  if (separator === -1) return undefined
  return {
    username: decoded.slice(0, separator) || "opencode",
    password: decoded.slice(separator + 1),
  }
}

export function serverClientOptions(input: { server: ServerConnection.HttpBase; fetch?: typeof globalThis.fetch }) {
  return {
    baseUrl: input.server.url,
    fetch: input.fetch,
    headers: input.server.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({ username: input.server.username, password: input.server.password })}`,
        }
      : undefined,
  }
}

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const options = serverClientOptions({ server, fetch: config.fetch })

  return createOpencodeClient({
    ...config,
    headers: {
      ...(config.headers instanceof Headers || Array.isArray(config.headers)
        ? Object.fromEntries(config.headers instanceof Headers ? config.headers.entries() : config.headers)
        : config.headers),
      ...options.headers,
    },
    baseUrl: server.url,
  })
}

export function createApiForServer(input: {
  server: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
}): ServerApi {
  const options = serverClientOptions(input)
  return withCurrentContract(OpenCode.make(options), options)
}

export function createApprovalApiForServer(input: {
  server: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
}) {
  return createApprovalApi(serverClientOptions(input))
}

export type ServerApi = Omit<OpenCodeClient, "session"> & {
  session: Omit<OpenCodeClient["session"], "prompt" | "list"> & {
    getInstructions: (input: { sessionID: string }, options?: { signal?: AbortSignal }) => Promise<string>
    setInstructions: (input: { sessionID: string; instructions: string }, options?: { signal?: AbortSignal }) => Promise<void>
    list: (
      input?: Parameters<OpenCodeClient["session"]["list"]>[0] & SessionsListInput,
      options?: Parameters<OpenCodeClient["session"]["list"]>[1],
    ) => ReturnType<OpenCodeClient["session"]["list"]>
    prompt: (
      input: Parameters<OpenCodeClient["session"]["prompt"]>[0] & LegacyPrompt,
      options?: Parameters<OpenCodeClient["session"]["prompt"]>[1],
    ) => Promise<SessionsPromptOutput>
    health: (input: { sessionID: string }, options?: { signal?: AbortSignal }) => Promise<SessionsHealthOutput>
    handoff: (input: { sessionID: string }, options?: { signal?: AbortSignal }) => Promise<SessionsHandoffOutput>
  }
}
