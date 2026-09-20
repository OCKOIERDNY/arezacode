import { createEffect, createMemo, createUniqueId, For, on } from "solid-js"
import { createStore } from "solid-js/store"
import type { Part, UserMessage } from "@opencode-ai/sdk/v2"
import { useLanguage } from "@/context/language"
import "./message-navigator.css"

export function MessageNavigator(props: {
  messages: UserMessage[]
  active?: string
  parts: (id: string) => Part[]
  reply: (id: string) => string
  onNavigate: (message: UserMessage, behavior: ScrollBehavior) => void
}) {
  const language = useLanguage()
  const previewID = createUniqueId()
  const [state, setState] = createStore({ index: -1, top: 0, shown: false, keyboard: false })
  let root!: HTMLElement
  createEffect(
    on(
      () => props.active,
      () => {
        if (state.shown) return
        const button = root.querySelector<HTMLButtonElement>("button[aria-current]")
        const list = button?.parentElement
        if (!button || !list) return
        if (
          button.offsetTop < list.scrollTop ||
          button.offsetTop + button.offsetHeight > list.scrollTop + list.clientHeight
        ) {
          list.scrollTop = button.offsetTop - list.clientHeight / 2
        }
      },
    ),
  )
  const title = (message: UserMessage) => {
    const text = props
      .parts(message.id)
      .flatMap((part) => (part.type === "text" && !part.synthetic ? [part.text] : []))
      .join(" ")
    return text || message.summary?.title || language.t("session.navigator.attachment")
  }
  const preview = createMemo(() => {
    const message = props.messages[state.index]
    return message ? { title: title(message), reply: props.reply(message.id) } : undefined
  })
  const reveal = (index: number, button: HTMLButtonElement, keyboard: boolean) => {
    const rect = root.getBoundingClientRect()
    const item = button.getBoundingClientRect()
    setState({ index, shown: true, keyboard, top: Math.max(0, Math.min(rect.height - 152, item.top - rect.top - 52)) })
  }

  return (
    <nav
      ref={root}
      data-component="message-navigator"
      data-keyboard={state.keyboard || undefined}
      aria-label={language.t("session.navigator.label")}
      onPointerLeave={() => !state.keyboard && setState("shown", false)}
      onFocusOut={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setState("shown", false)
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setState("shown", false)
          return
        }
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
        event.preventDefault()
        const buttons = [...event.currentTarget.querySelectorAll("button")]
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : index + (event.key === "ArrowDown" ? 1 : -1)
        buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus()
      }}
    >
      <div data-slot="navigator-marks">
        <For each={props.messages}>
          {(message, index) => (
            <button
              type="button"
              aria-label={language.t("session.navigator.turn", { number: index() + 1 })}
              aria-current={props.active === message.id ? "step" : undefined}
              aria-describedby={state.shown && state.index === index() ? previewID : undefined}
              data-message-target={message.id}
              data-preview={(state.shown && state.index === index()) || undefined}
              style={{
                "--mark-scale": state.shown
                  ? Math.max(1, 4 - Math.abs(state.index - index()))
                  : props.active === message.id
                    ? 3
                    : 1,
              }}
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") reveal(index(), event.currentTarget, false)
              }}
              onFocus={(event) => {
                if (event.currentTarget.matches(":focus-visible")) reveal(index(), event.currentTarget, true)
              }}
              onClick={(event) => {
                props.onNavigate(
                  message,
                  event.detail === 0 || matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
                )
              }}
            >
              <span />
            </button>
          )}
        </For>
      </div>
      <div
        id={previewID}
        role="tooltip"
        data-slot="navigator-preview"
        data-open={state.shown || undefined}
        aria-hidden={!state.shown}
        style={{ top: `${state.top}px` }}
      >
        <div data-slot="navigator-title">{preview()?.title}</div>
        <div data-slot="navigator-reply">{preview()?.reply}</div>
      </div>
    </nav>
  )
}
