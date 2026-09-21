import { Permission } from "@opencode-ai/schema/permission"
import { Schema } from "effect"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { OpenCode, type OpenCodeClient } from "@opencode-ai/client/promise"
import type { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"

export function authTokenFromCredentials(input: { username?: string; password: string }) {
  return btoa(`${input.username ?? "opencode"}:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)
  if (!decoded) return
  const separator = decoded.indexOf(":")
  if (separator === -1) return
  return {
    username: decoded.slice(0, separator) || "opencode",
    password: decoded.slice(separator + 1),
  }
}

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const auth = (() => {
    if (!server.password) return
    return {
      Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
    }
  })()

  return createOpencodeClient({
    ...config,
    headers: {
      ...(config.headers instanceof Headers ? Object.fromEntries(config.headers.entries()) : config.headers),
      ...auth,
    },
    baseUrl: server.url,
  })
}

export function createApiForServer(input: {
  server: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
}): OpenCodeClient {
  return OpenCode.make({
    baseUrl: input.server.url,
    fetch: input.fetch,
    headers: input.server.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({
            username: input.server.username,
            password: input.server.password,
          })}`,
        }
      : undefined,
  })
}

export function createApprovalApiForServer(input: { server: ServerConnection.HttpBase; fetch?: typeof globalThis.fetch }) {
  const request = async (sessionID: string, mode?: Permission.ApprovalMode) => {
    const response = await (input.fetch ?? fetch)(new URL(`/api/session/${encodeURIComponent(sessionID)}${mode ? "/approval" : ""}`, input.server.url), {
      method: mode ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(input.server.password ? { Authorization: `Basic ${authTokenFromCredentials({ username: input.server.username, password: input.server.password })}` } : {}),
      },
      ...(mode ? { body: JSON.stringify({ mode }) } : {}),
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`Approval request failed (${response.status})`)
    if (mode) return
    const body: unknown = await response.json()
    const data = body && typeof body === "object" && "data" in body ? body.data : body
    if (!data || typeof data !== "object" || !("id" in data)) throw new Error("Invalid session response")
    const value = "approvalMode" in data ? data.approvalMode : undefined
    return Schema.is(Permission.ApprovalMode)(value) ? value : "default"
  }
  return {
    get: (sessionID: string) => request(sessionID),
    set: (sessionID: string, mode: Permission.ApprovalMode) => request(sessionID, mode),
  }
}

export type ServerApi = OpenCodeClient
