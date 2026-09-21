import { createEffect, createMemo, onCleanup, untrack, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import type { ProjectServicesState } from "@/project-services"

export function useProjectServices(active: Accessor<boolean>) {
  const platform = usePlatform()
  const sdk = useSDK()
  const server = useServer()
  const available = createMemo(() => !!platform.projectServices && server.isLocal())
  const [store, setStore] = createStore({
    data: undefined as ProjectServicesState | undefined,
    loading: false,
    failed: false,
    stopping: "",
    stopFailed: false,
  })
  let revision = 0
  const refresh = async () => {
    if (!available() || !active() || store.loading || store.stopping) return
    const current = revision
    setStore({ loading: true, failed: false })
    await platform.projectServices!.list(sdk().directory).then(
      (data) => {
        if (current === revision) setStore({ data, loading: false })
      },
      () => {
        if (current === revision) setStore({ failed: true, loading: false })
      },
    )
  }
  const stop = async (id: string) => {
    if (!available() || store.stopping) return
    const current = ++revision
    setStore({ stopping: id, stopFailed: false, loading: false })
    await platform.projectServices!.stop(sdk().directory, id).then(
      () => {
        if (current === revision) setStore("stopping", "")
      },
      () => {
        if (current === revision) setStore({ stopping: "", stopFailed: true })
      },
    )
    if (current === revision) await refresh()
  }
  createEffect(() => {
    sdk().directory
    const enabled = available() && active()
    revision++
    setStore({ data: undefined, loading: false, failed: false, stopping: "", stopFailed: false })
    if (!enabled) return
    untrack(() => void refresh())
    const timer = setInterval(() => void refresh(), 10000)
    onCleanup(() => {
      revision++
      clearInterval(timer)
    })
  })
  return { store, available, refresh, stop }
}
