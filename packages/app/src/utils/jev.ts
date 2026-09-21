import { createStore } from "solid-js/store"
import { Jev } from "@opencode-ai/schema/jev"
import { Schema } from "effect"
import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "./server"
import { Integration } from "@opencode-ai/schema/integration"
import { SessionMessage } from "@opencode-ai/schema/session-message"

function createRequest(server: ServerConnection.HttpBase, fetcher: typeof fetch) {
  return async (method: string, path: string, body?: unknown, signal?: AbortSignal) => {
    const response = await fetcher(new URL(path, server.url), {
      method,
      headers: { "Content-Type": "application/json", ...(server.password ? { Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ?? AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`Request failed (${response.status})`)
    return response.json()
  }
}

export function createToolsClient(server: ServerConnection.HttpBase, fetcher: typeof fetch = fetch) {
  const request = createRequest(server, fetcher)
  const status = Schema.decodeUnknownSync(Schema.Array(Integration.EngineStatus))
  return {
    sessionUsage: async (sessionID: string) => Schema.encodeSync(Schema.Array(SessionMessage.UsageEntry))(Schema.decodeUnknownSync(Schema.Array(SessionMessage.UsageEntry))(await request("GET", `/api/session/${encodeURIComponent(sessionID)}/usage`))),
    toolsList: async () => status(await request("GET", "/api/tools")),
    toolsAction: async (input: { engineID: typeof Integration.EngineID.Type } & typeof Integration.EngineAction.Type) =>
      status(await request("POST", `/api/tools/${input.engineID}`, { action: input.action })),
  }
}

export function createJevClient(server: ServerConnection.HttpBase, fetcher: typeof fetch = fetch) {
  const send = createRequest(server, fetcher)
  const [state, setState] = createStore({
    enabled: false,
    skills: true,
    context: true,
    findings: true,
    routing: true,
    configured: false,
    loaded: false,
    saving: false,
    error: false,
  })
  const request = async (method: string, suffix = "", body?: unknown, directory?: string) => {
    const url = new URL(`/api/jev${suffix}`, server.url)
    if (directory) url.searchParams.set("location[directory]", directory)
    return send(method, url.pathname + url.search, body, AbortSignal.timeout(5000))
  }
  const refresh = async () => {
    const value = await request("GET").catch(() => undefined)
    if (!value || typeof value.enabled !== "boolean" || typeof value.configured !== "boolean") {
      setState({ loaded: true, error: true })
      return
    }
    setState({ ...value, loaded: true, error: false })
  }
  return {
    state,
    available: () => state.loaded && state.configured && state.enabled && !state.error,
    refresh,
    async update(changes: Partial<typeof Jev.Update.Type>) {
      if (state.saving) return false
      setState({ saving: true, error: false })
      const value = await request("PATCH", "", {
        enabled: state.enabled,
        skills: state.skills,
        context: state.context,
        findings: state.findings,
        routing: state.routing,
        ...changes,
      }).catch(() => undefined)
      setState({ saving: false, error: !value })
      if (!value) return false
      setState({ ...value, loaded: true })
      return true
    },
    async prepare(input: typeof Jev.Prepare.Type, directory: string): Promise<typeof Jev.Prepared.Type | undefined> {
      if (!state.loaded) await refresh()
      if (!state.enabled) return
      return request("POST", "/prepare", input, directory)
        .then(Schema.decodeUnknownSync(Jev.Prepared))
        .catch(() => undefined)
    },
  }
}
