import { createEffect, on, type Accessor } from "solid-js"
import { useQuery } from "@tanstack/solid-query"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"

export function useSessionHealth(sessionID: Accessor<string | undefined>) {
  const sdk = useSDK()
  const sync = useSync()
  const working = () => {
    const id = sessionID()
    return !!id && sync().data.session_working(id)
  }
  const query = useQuery(() => {
    const id = sessionID()
    const api = sdk().api.session
    return {
      queryKey: [sdk().scope, "session-health", id],
      enabled: !!id,
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        if (!id) throw new Error("Session ID is required")
        return api.health({ sessionID: id }, { signal })
      },
      refetchInterval: working() ? 3000 : false,
      retry: 1,
    }
  })
  createEffect(on(working, () => {
    if (sessionID()) void query.refetch()
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
