export function resizeKey(input: {
  key: string
  direction: "horizontal" | "vertical"
  edge?: "start" | "end"
  rtl: boolean
  size: number
  min: number
  max: number
}) {
  if (input.key === "Home") return input.min
  if (input.key === "End") return input.max
  const horizontal = input.direction === "horizontal"
  const decrease = horizontal ? "ArrowLeft" : "ArrowUp"
  const increase = horizontal ? "ArrowRight" : "ArrowDown"
  if (input.key !== decrease && input.key !== increase) return undefined
  const edge = input.edge ?? (horizontal ? "end" : "start")
  const sign = (edge === "start") !== (horizontal && input.rtl) ? -1 : 1
  return Math.min(input.max, Math.max(input.min, input.size + (input.key === decrease ? -16 : 16) * sign))
}
