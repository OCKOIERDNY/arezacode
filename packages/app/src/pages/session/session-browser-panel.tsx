import { createEffect, createMemo, For, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { EmptyState } from "@opencode-ai/ui/empty-state"
import { Icon } from "@opencode-ai/ui/icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import type { BrowserState, BrowserUpdate } from "@/browser"
import { useProjectServices } from "@/hooks/use-project-services"

export function SessionBrowserPanel(props: { active: boolean; url?: string; id?: string }) {
  const platform = usePlatform()
  const language = useLanguage()
  const dialog = useDialog()
  const services = useProjectServices(() => props.active)
  const localURLs = createMemo(() => [
    ...new Set(services.store.data?.services.flatMap((service) => service.urls) ?? []),
  ])
  const id = props.id ?? crypto.randomUUID()
  const [store, setStore] = createStore({
    address: props.url ?? "",
    invalid: false,
    failed: false,
    preview: undefined as string | undefined,
    state: { id, url: "", title: "", loading: false, back: false, forward: false } as BrowserState,
  })
  let viewport: HTMLDivElement | undefined
  let frame = 0
  let previous = ""
  let disposed = false
  const receive = (state: BrowserState) => {
    if (disposed || state.id !== id) return
    const changed = state.url !== store.state.url
    setStore("state", state)
    if (changed && state.url) setStore("address", state.url)
  }
  const update = (input: Omit<BrowserUpdate, "id">) => {
    if (disposed) return
    void platform.browser?.update({ id, ...input }).then(
      (state) => {
        if (disposed) return
        receive(state)
        setStore("failed", false)
        if (input.visible) setStore("preview", undefined)
      },
      () => {
        if (!disposed) setStore("failed", true)
      },
    )
  }
  const navigate = (value: string) => {
    const raw = value.trim()
    const target =
      /^[a-z][a-z\d+.-]*:/i.test(raw) && !/^localhost:\d/i.test(raw)
        ? raw
        : `${/^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(raw) ? "http" : "https"}://${raw}`
    const url = URL.canParse(target) ? new URL(target) : undefined
    if (!url || !/^https?:$/.test(url.protocol) || url.username || url.password) {
      setStore("invalid", true)
      return
    }
    setStore("invalid", false)
    setStore("address", url.href)
    if (!platform.browser) {
      platform.openExternal(url.href)
      return
    }
    update({ url: url.href })
  }
  const bounds = () => {
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    const visible =
      props.active &&
      !document.hidden &&
      !store.state.error &&
      !store.failed &&
      !!store.state.url &&
      rect.width > 0 &&
      rect.height > 0
    const covered =
      dialog.active ||
      !!viewport.closest("[inert]") ||
      !!document.querySelector(
        '[role="menu"][data-expanded], [role="dialog"], [data-component="popover-content"][data-expanded]',
      )
    const input = {
      visible: visible && !covered,
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    }
    const next = JSON.stringify(input)
    if (next === previous) return
    previous = next
    if (visible && covered && platform.browser) {
      void platform.browser
        .update({ id, action: "capture" })
        .then(async (state) => {
          if (disposed || previous !== next) return
          if (!state.preview) {
            update(input)
            return
          }
          const image = new Image()
          image.src = state.preview
          await image.decode()
          if (disposed || previous !== next) return
          setStore("preview", state.preview)
          requestAnimationFrame(() => {
            if (!disposed && previous === next) update(input)
          })
        })
        .catch(() => {
          if (!disposed && previous === next) update(input)
        })
      return
    }
    if (!visible) setStore("preview", undefined)
    update(input)
  }
  const schedule = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(bounds)
  }
  createEffect(() => {
    props.active
    dialog.active
    platform.webviewZoom?.()
    store.state.url
    store.state.error
    store.failed
    schedule()
  })
  createEffect(() => {
    if (props.url) navigate(props.url)
  })
  onMount(() => {
    const unsubscribe = platform.browser?.subscribe(receive)
    const resize = new ResizeObserver(schedule)
    if (viewport) resize.observe(viewport)
    const overlay = '[role="menu"], [role="dialog"], [data-component="popover-content"]'
    const observer = new MutationObserver((records) => {
      if (!props.active) return
      if (
        records.some(
          (record) =>
            record.type === "attributes" ||
            [...record.addedNodes, ...record.removedNodes].some(
              (node) => node instanceof Element && (node.matches(overlay) || node.querySelector(overlay)),
            ),
        )
      )
        schedule()
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["inert", "data-expanded", "data-state"],
    })
    window.addEventListener("resize", schedule)
    document.addEventListener("visibilitychange", schedule)
    document.addEventListener("transitionend", schedule)
    schedule()
    onCleanup(() => {
      disposed = true
      unsubscribe?.()
      resize.disconnect()
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", schedule)
      document.removeEventListener("visibilitychange", schedule)
      document.removeEventListener("transitionend", schedule)
      void platform.browser?.close(id).catch(() => {})
    })
  })
  return (
    <div class="flex flex-col h-full min-h-0" data-component="session-browser">
      <form
        class="flex items-center gap-1 p-2 shrink-0 border-b border-border-weaker-base"
        onSubmit={(event) => {
          event.preventDefault()
          navigate(store.address)
        }}
      >
        <IconButton
          icon="arrow-left"
          variant="ghost"
          aria-label={language.t("session.browser.back")}
          disabled={!store.state.back}
          onClick={() => update({ action: "back" })}
        />
        <IconButton
          icon="arrow-right"
          variant="ghost"
          aria-label={language.t("session.browser.forward")}
          disabled={!store.state.forward}
          onClick={() => update({ action: "forward" })}
        />
        <Button
          variant="ghost"
          size="small"
          disabled={!store.state.url}
          onClick={() => update({ action: store.state.loading ? "stop" : "reload" })}
        >
          {language.t(store.state.loading ? "session.browser.stop" : "session.browser.reload")}
        </Button>
        <input
          class="flex-1 min-w-0 h-8 px-2 rounded-md bg-surface-base text-13-regular text-text-strong outline-none focus:ring-1 focus:ring-border-active"
          aria-label={language.t("session.browser.address")}
          placeholder={language.t("session.browser.address")}
          value={store.address}
          onInput={(event) => setStore("address", event.currentTarget.value)}
          aria-invalid={store.invalid}
        />
        <IconButton
          icon="square-arrow-top-right"
          variant="ghost"
          aria-label={language.t("session.browser.external")}
          disabled={!store.state.url}
          onClick={() => platform.openExternal(store.state.url)}
        />
      </form>
      <Show when={services.available()}>
        <div class="flex items-center gap-2 px-3 py-2 shrink-0 border-b border-border-weaker-base">
          <DropdownMenu gutter={4} placement="bottom-start">
            <DropdownMenu.Trigger
              as={Button}
              variant="ghost"
              size="small"
              class="min-w-0 max-w-64 gap-2 data-[expanded]:bg-surface-base-active"
              disabled={!localURLs().length}
              aria-label={language.t("session.browser.localServers")}
            >
              <Icon name="server" size="small" class="shrink-0 text-icon-weak" />
              <span class="truncate">
                {localURLs()
                  .find((url) => store.address.startsWith(url))
                  ?.replace(/^https?:\/\//, "")
                  .replace(/\/$/, "") ??
                  language.t(
                    services.store.loading
                      ? "common.loading"
                      : localURLs().length
                        ? "session.browser.localServers"
                        : "session.browser.noLocalServers",
                  )}
              </span>
              <Icon name="chevron-down" size="small" class="shrink-0 text-icon-weak" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content class="min-w-52 max-w-80 max-h-64 overflow-y-auto">
                <DropdownMenu.RadioGroup
                  value={localURLs().find((url) => store.address.startsWith(url)) ?? ""}
                  onChange={(value) => {
                    if (typeof value === "string") navigate(value)
                  }}
                >
                  <For each={localURLs()}>
                    {(url) => (
                      <DropdownMenu.RadioItem value={url} closeOnSelect>
                        <span class="flex-1 truncate">{url.replace(/\/$/, "")}</span>
                        <DropdownMenu.ItemIndicator>
                          <Icon name="check-small" size="small" />
                        </DropdownMenu.ItemIndicator>
                      </DropdownMenu.RadioItem>
                    )}
                  </For>
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="small"
            disabled={services.store.loading}
            onClick={() => void services.refresh()}
          >
            {language.t("session.panel.refresh")}
          </Button>
        </div>
        <Show when={services.store.failed}>
          <div role="alert" class="px-4 py-2 text-12-regular text-text-weak">
            {language.t("session.servers.error")}
          </div>
        </Show>
      </Show>
      <Show when={store.invalid}>
        <div role="alert" class="px-4 py-2 text-12-regular text-text-weak">
          {language.t("session.browser.invalid")}
        </div>
      </Show>
      <div ref={viewport} class="flex-1 min-h-0 relative flex flex-col overflow-y-auto">
        <Show when={store.preview}>
          {(preview) => (
            <img
              data-component="browser-preview-snapshot"
              src={preview()}
              alt=""
              class="absolute inset-0 size-full object-fill pointer-events-none"
            />
          )}
        </Show>
        <Show when={!store.state.url || store.failed || store.state.error}>
          <Show
            when={store.failed || store.state.error}
            fallback={
              <EmptyState
                icon={<Icon name="window-cursor" />}
                title={language.t("session.browser.empty.title")}
                description={language.t(platform.browser ? "session.browser.empty" : "session.browser.desktop")}
              />
            }
          >
            <div role="alert" class="flex flex-1">
              <EmptyState
                icon={<Icon name="circle-ban-sign" />}
                title={language.t("session.browser.error.title")}
                description={language.t("session.browser.error")}
              />
            </div>
          </Show>
        </Show>
      </div>
    </div>
  )
}
