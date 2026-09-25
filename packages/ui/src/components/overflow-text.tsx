import { createEffect, onCleanup, type JSX } from "solid-js"
import "./overflow-text.css"

export function OverflowText(props: { children: JSX.Element; fade?: boolean }) {
  let root: HTMLSpanElement | undefined
  createEffect(() => {
    props.children
    if (!props.fade || !root) return
    const element = root
    const update = () =>
      element.toggleAttribute("data-overflow", (element.firstElementChild?.scrollWidth ?? 0) > element.clientWidth)
    const observer = new ResizeObserver(update)
    observer.observe(element)
    update()
    onCleanup(() => observer.disconnect())
  })
  return (
    <span
      ref={root}
      data-fade={props.fade || undefined}
      data-component="overflow-text"
      class="min-w-0 flex-1 overflow-hidden"
      onPointerEnter={(event) => {
        const distance = Math.max(
          0,
          (event.currentTarget.firstElementChild?.scrollWidth ?? 0) - event.currentTarget.clientWidth,
        )
        event.currentTarget.style.setProperty("--title-overflow", `${distance}px`)
        event.currentTarget.style.setProperty("--title-duration", `${distance / 24}s`)
      }}
    >
      <span class="block overflow-hidden text-ellipsis whitespace-nowrap">{props.children}</span>
    </span>
  )
}
