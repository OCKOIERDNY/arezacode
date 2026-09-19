import { For, type ComponentProps } from "solid-js"

export const wordmarkPaths = [
  "M0 18h72v18H0ZM54 36h18v18H54ZM0 54h72v18H0ZM0 72h18v18H0ZM54 72h18v18H54ZM0 90h72v18H0Z",
  "M90 18h72v18H90ZM90 36h18v18H90ZM144 36h18v18H144ZM90 54h18v18H90ZM90 72h18v18H90ZM90 90h18v18H90Z",
  "M180 18h72v18H180ZM180 36h18v18H180ZM234 36h18v18H234ZM180 54h72v18H180ZM180 72h18v18H180ZM180 90h72v18H180Z",
  "M270 18h72v18H270ZM324 36h18v18H324ZM288 54h36v18H288ZM270 72h18v18H270ZM270 90h72v18H270Z",
  "M360 18h72v18H360ZM414 36h18v18H414ZM360 54h72v18H360ZM360 72h18v18H360ZM414 72h18v18H414ZM360 90h72v18H360Z",
  "M450 18h72v18H450ZM450 36h18v18H450ZM450 54h18v18H450ZM450 72h18v18H450ZM450 90h72v18H450Z",
  "M540 18h72v18H540ZM540 36h18v18H540ZM594 36h18v18H594ZM540 54h18v18H540ZM594 54h18v18H594ZM540 72h18v18H540ZM594 72h18v18H594ZM540 90h72v18H540Z",
  "M684 0h18v18H684ZM630 18h72v18H630ZM630 36h18v18H630ZM684 36h18v18H684ZM630 54h18v18H630ZM684 54h18v18H684ZM630 72h18v18H630ZM684 72h18v18H684ZM630 90h72v18H630Z",
  "M720 18h72v18H720ZM720 36h18v18H720ZM774 36h18v18H774ZM720 54h72v18H720ZM720 72h18v18H720ZM720 90h72v18H720Z",
]

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path data-slot="logo-logo-mark-shadow" d="M12 16H4V8H12V16Z" fill="var(--icon-weak-base)" />
      <path data-slot="logo-logo-mark-o" d="M12 4H4V16H12V4ZM16 20H0V0H16V20Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M60 80H20V40H60V80Z" fill="var(--icon-base)" />
      <path d="M60 20H20V80H60V20ZM80 100H0V0H80V100Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      role="img"
      aria-label="ArezaCode"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 792 126"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <For each={wordmarkPaths}>
        {(path, index) => <path d={path} fill={index() < 5 ? "var(--icon-base)" : "var(--icon-strong-base)"} />}
      </For>
    </svg>
  )
}
