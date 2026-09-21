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
    starting: "",
    startFailed: false,
  })
  let revision = 0
  const refresh = async () => {
    if (!available() || !active() || store.loading || store.stopping || store.starting) return
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
  const change = async (action: "start" | "stop", id: string) => {
    if (!available() || store.stopping || store.starting) return
    const current = ++revision
    const pending = action === "start" ? "starting" : "stopping"
    const failed = action === "start" ? "startFailed" : "stopFailed"
    setStore({ [pending]: id, startFailed: false, stopFailed: false, loading: false })
    await platform.projectServices![action](sdk().directory, id).then(
      () => {
        if (current === revision) setStore(pending, "")
      },
      () => {
        if (current === revision) setStore({ [pending]: "", [failed]: true })
      },
    )
    if (current === revision) await refresh()
  }
  createEffect(() => {
    sdk().directory
    const enabled = available() && active()
    revision++
    setStore({
      data: undefined,
      loading: false,
      failed: false,
      stopping: "",
      stopFailed: false,
      starting: "",
      startFailed: false,
    })
    if (!enabled) return
    untrack(() => void refresh())
    const timer = setInterval(() => void refresh(), 10000)
    onCleanup(() => {
      revision++
      clearInterval(timer)
    })
  })
  return {
    store,
    available,
    refresh,
    stop: (id: string) => change("stop", id),
    start: (id: string) => change("start", id),
  }
}
