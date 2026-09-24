import { createEffect, on, type Accessor } from "solid-js"
import { useQuery } from "@tanstack/solid-query"
import { useSDK, type DirectorySDK } from "@/context/sdk"
import { useSync } from "@/context/sync"

export function useSessionHealth(sessionID: Accessor<string | undefined>) {
  const sdk = useSDK()
  const sync = useSync()
  const working = () => {
    const id = sessionID()
    return !!id && sync().data.session_working(id)
  }
  return createSessionHealth(sessionID, sdk, working)
}

export function createSessionHealth(
  sessionID: Accessor<string | undefined>,
  sdk: Accessor<DirectorySDK | undefined>,
  working: Accessor<boolean>,
) {
  const query = useQuery(() => {
    const id = sessionID()
    const current = sdk()
    return {
      queryKey: [current?.scope, "session-health", id],
      enabled: !!id && !!current,
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        if (!id || !current) throw new Error("Session ID and SDK are required")
        return current.api.session.health({ sessionID: id }, { signal })
      },
      refetchInterval: working() ? 3000 : false,
      retry: 1,
    }
  })
  createEffect(on(working, () => {
    if (sessionID() && sdk()) void query.refetch()
  }, { defer: true }))
  const locked = () => query.data?.locked === true
  return {
    query,
    locked,
    readonly: () => locked() && !working(),
    state: () => locked()
      ? working() ? "finishing" as const : "locked" as const
      : query.data?.inputTokens !== undefined && query.data.inputTokens >= query.data.limit * 0.9
        ? "near" as const
        : "healthy" as const,
  }
}
