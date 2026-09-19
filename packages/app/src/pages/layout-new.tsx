import { createEffect, createMemo, Show, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { DebugBar } from "@/components/debug-bar"
import { Titlebar, type TitlebarUpdate } from "@/components/titlebar"
import { usePlatform } from "@/context/platform"
import { setV2Toast, ToastRegion } from "@/utils/toast"
import { useLayout } from "@/context/layout"
import { HomeSidebar } from "./home"

export default function NewLayout(props: ParentProps) {
  const platform = usePlatform()
  const [state, setState] = createStore({ debugTools: true })
  const layout = useLayout()
  const sidebarPresent = createMemo<boolean>((previous) => previous || layout.projectSidebar.opened(), false)

  createEffect(() => setV2Toast(true))

  const update: TitlebarUpdate = {
    version: () => {
      const state = platform.updater?.state()
      if (state?.status !== "ready") return
      return state.version
    },
    installing: () => platform.updater?.state().status === "installing",
    install: () => void platform.updater?.install(),
  }

  return (
    <div
      class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        "padding-top": "env(safe-area-inset-top, 0px)",
        "padding-bottom": "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <Titlebar
        update={update}
        sidebar={{ opened: layout.projectSidebar.opened(), toggle: layout.projectSidebar.toggle }}
        debugTools={
          import.meta.env.DEV
            ? { visible: state.debugTools, toggle: () => setState("debugTools", (value) => !value) }
            : undefined
        }
      />
      <div class="relative flex flex-1 min-h-0 min-w-0">
        <div
          data-component="project-sidebar-slot"
          data-collapsing={!layout.projectSidebar.opened() || layout.projectSidebar.preview()}
          inert={!layout.projectSidebar.opened() || layout.projectSidebar.preview()}
          class="shrink-0 min-h-0 min-w-0 py-2 data-[collapsing=true]:overflow-clip max-md:contents"
          style={{
            width: `${layout.projectSidebar.opened() && !layout.projectSidebar.preview() ? Math.min(480, Math.max(220, layout.sidebar.width())) : 0}px`,
          }}
        >
          <Show when={sidebarPresent()}>
            <Suspense>
              <HomeSidebar
                onCollapse={layout.projectSidebar.close}
                debugTools={
                  import.meta.env.DEV
                    ? { visible: state.debugTools, toggle: () => setState("debugTools", (value) => !value) }
                    : undefined
                }
              />
            </Suspense>
          </Show>
        </div>
        <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
          <Suspense>{props.children}</Suspense>
        </main>
      </div>
      {import.meta.env.DEV && state.debugTools && <DebugBar inline />}
      <ToastRegion v2 />
    </div>
  )
}
