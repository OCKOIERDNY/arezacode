export function expandCommandTemplate(template: string, input: string) {
  const args = (input.match(/(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi) ?? []).map((arg) =>
    arg.replace(/^["']|["']$/g, ""),
  )
  const placeholders = template.match(/\$(\d+)/g) ?? []
  const last = Math.max(0, ...placeholders.map((item) => Number(item.slice(1))))
  const result = template.replaceAll(/\$ARGUMENTS|\$(\d+)/g, (placeholder, index) => {
    if (placeholder === "$ARGUMENTS") return input
    const position = Number(index)
    if (position - 1 >= args.length) return ""
    if (position === last) return args.slice(position - 1).join(" ")
    return args[position - 1] ?? ""
  })
  return placeholders.length === 0 && !template.includes("$ARGUMENTS") && input.trim()
    ? `${result}\n\n${input}`
    : result
}
