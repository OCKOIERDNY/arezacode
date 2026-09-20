import type { Component, JSX } from "solid-js"
import { createMemo, Show, splitProps } from "solid-js"
import sprite from "./provider-icons/sprite.svg"
import { iconNames, type IconName } from "./provider-icons/types"

export type ProviderIconProps = JSX.SVGElementTags["svg"] & {
  id: string
}

export const ProviderIcon: Component<ProviderIconProps> = (props) => {
  const [local, rest] = splitProps(props, ["id", "class", "classList"])
  const resolved = createMemo(() => (iconNames.includes(local.id as IconName) ? local.id : "synthetic"))
  return (
    <svg
      data-component="provider-icon"
      viewBox="0 0 24 24"
      {...rest}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <Show when={resolved() === "opencode"} fallback={<use href={`${sprite}#${resolved()}`} />}>
        <path
          d="M8.40005 17.4H19.2001V21H4.80005V13.8H8.40005V17.4ZM15.6001 10.2V13.8H8.40005V10.2H15.6001ZM19.2001 10.2H15.6001V6.6H4.80005V3H19.2001V10.2Z"
          fill="currentColor"
        />
      </Show>
    </svg>
  )
}
