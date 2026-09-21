import { batch, onCleanup, splitProps, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

export interface ResizeHandleProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onResize"> {
  direction: "horizontal" | "vertical"
  edge?: "start" | "end"
  size: number
  min: number
  max: number
  onResize: (size: number) => void
  onResizeEnd?: (size: number, startSize: number) => void
  onCollapse?: () => void
  /** Called while dragging when size crosses `collapseThreshold`. */
  onCollapseChange?: (collapsed: boolean) => void
  collapseThreshold?: number
}

export function ResizeHandle(props: ResizeHandleProps) {
  const [state, setState] = createStore({ dragging: false })
  let cleanup: (() => void) | undefined
  onCleanup(() => cleanup?.())
  const [local, rest] = splitProps(props, [
    "direction",
    "edge",
    "size",
    "min",
    "max",
    "onResize",
    "onResizeEnd",
    "onCollapse",
    "onCollapseChange",
    "collapseThreshold",
    "class",
    "classList",
  ])

  const handleMouseDown = (e: MouseEvent) => {
    if (e.detail > 1) return
    e.preventDefault()
    cleanup?.()
    const edge = local.edge ?? (local.direction === "vertical" ? "start" : "end")
    const start = local.direction === "horizontal" ? e.clientX : e.clientY
    const rtl =
      local.direction === "horizontal" &&
      e.currentTarget instanceof Element &&
      getComputedStyle(e.currentTarget).direction === "rtl"
    const startSize = local.size
    const min = local.min
    const max = local.max
    const threshold = local.collapseThreshold ?? 0
    const onResize = local.onResize
    const onCollapse = local.onCollapse
    const onCollapseChange = local.onCollapseChange
    let current = startSize
    let collapsed = false
    let frame: number | undefined

    const userSelect = document.body.style.userSelect
    const overflow = document.body.style.overflow
    document.body.style.userSelect = "none"
    document.body.style.overflow = "hidden"
    setState("dragging", true)
    const cursor = document.body.style.cursor
    document.body.style.cursor = local.direction === "horizontal" ? "col-resize" : "row-resize"

    const resize = () => {
      frame = undefined
      batch(() => {
        const nextCollapsed = local.collapseThreshold !== undefined && current < threshold
        if (nextCollapsed !== collapsed) {
          collapsed = nextCollapsed
          onCollapseChange?.(collapsed)
        }
        onResize(Math.min(max, Math.max(min, current)))
      })
    }

    const onMouseMove = (moveEvent: MouseEvent) => {
      const pos = local.direction === "horizontal" ? moveEvent.clientX : moveEvent.clientY
      const delta =
        local.direction === "vertical"
          ? edge === "end"
            ? pos - start
            : start - pos
          : (edge === "start") !== rtl
            ? start - pos
            : pos - start
      current = startSize + delta
      frame ??= requestAnimationFrame(resize)
    }

    const onMouseUp = () => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame)
        resize()
      }
      cleanup?.()
      local.onResizeEnd?.(current, startSize)

      if (collapsed) {
        onCollapse?.()
        return
      }
      onCollapseChange?.(false)
    }

    cleanup = () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      frame = undefined
      document.body.style.userSelect = userSelect
      document.body.style.overflow = overflow
      document.body.style.cursor = cursor
      setState("dragging", false)
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
      window.removeEventListener("blur", onMouseUp)
      cleanup = undefined
    }
    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
    window.addEventListener("blur", onMouseUp)
  }

  return (
    <div
      {...rest}
      data-component="resize-handle"
      data-direction={local.direction}
      data-dragging={state.dragging}
      data-edge={local.edge ?? (local.direction === "vertical" ? "start" : "end")}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
      onMouseDown={handleMouseDown}
    />
  )
}
