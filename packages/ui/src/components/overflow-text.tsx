import type { JSX } from "solid-js"
import "./overflow-text.css"

export function OverflowText(props: { children: JSX.Element }) {
  return (
    <span
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
