import { createEffect, createMemo, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { getTurnDurationMs } from "./turn-duration"

export function MessageElapsed(props: {
  created: number
  assistants: readonly { time: { completed?: number } }[]
  running: boolean
}) {
  const language = useLanguage()
  const [clock, setClock] = createStore({ now: Date.now() })
  createEffect(() => {
    if (!props.running) return
    setClock("now", Date.now())
    const timer = setInterval(() => setClock("now", Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })
  const elapsed = createMemo(() => getTurnDurationMs(props.created, props.assistants, props.running ? clock.now : undefined))
  const duration = () => {
    const seconds = Math.floor((elapsed() ?? 0) / 1000)
    return seconds < 60
      ? language.t("ui.message.duration.seconds", { count: seconds })
      : language.t("ui.message.duration.minutesSeconds", { minutes: Math.floor(seconds / 60), seconds: seconds % 60 })
  }
  return (
    <Show when={elapsed() !== undefined}>
      <div data-slot="message-elapsed" class="mt-1 text-start text-12-regular text-text-weak tabular-nums" aria-live="off">
        {language.t(props.running ? "session.message.elapsed" : "session.message.duration", { duration: duration() })}
      </div>
    </Show>
  )
}
