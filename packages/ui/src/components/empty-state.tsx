import type { JSX, ParentProps } from "solid-js"
import "./empty-state.css"

export function EmptyState(props: ParentProps<{ icon: JSX.Element; title: string; description: string }>) {
  return (
    <div data-component="empty-state">
      <div data-slot="empty-state-icon" aria-hidden="true">
        {props.icon}
      </div>
      <div data-slot="empty-state-title">{props.title}</div>
      <div data-slot="empty-state-description">{props.description}</div>
      {props.children}
    </div>
  )
}
