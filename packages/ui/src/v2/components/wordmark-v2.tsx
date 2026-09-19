import { createUniqueId, For, type ComponentProps } from "solid-js"
import { wordmarkPaths } from "../../components/logo"

export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class">) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      role="img"
      aria-label="ArezaCode"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 792 126"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g opacity="0.6">
        <g mask={`url(#${mask})`}>
          <g opacity="0.16">
            <For each={wordmarkPaths}>
              {(path) => <path opacity="0.7" d={path} fill="currentColor" />}
            </For>
          </g>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="792" height="126">
          <rect width="792" height="126" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="396" y1="68" x2="396" y2="126" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
