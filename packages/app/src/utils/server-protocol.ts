import type { ServerConnection } from "@/context/server"
import { serverClientOptions } from "./server"

export type ServerProtocol = "v1" | "v2"

async function probe(server: ServerConnection.HttpBase, fetch: typeof globalThis.fetch, path: string) {
  const response = await fetch(new URL(path, server.url), {
    headers: serverClientOptions({ server }).headers,
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return
  const value: unknown = await response.json()
  if (!value || typeof value !== "object") return
  return value
}

export async function detectServerProtocol(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
): Promise<ServerProtocol> {
  const legacy = await probe(server, fetch, "/global/health").catch(() => undefined)
  if (legacy && "healthy" in legacy && legacy.healthy === true) return "v1"

  const current = await probe(server, fetch, "/api/health").catch(() => undefined)
  if (current && "pid" in current && typeof current.pid === "number") return "v2"
  if (current && "healthy" in current && current.healthy === true) return "v1"
  return "v2"
}
