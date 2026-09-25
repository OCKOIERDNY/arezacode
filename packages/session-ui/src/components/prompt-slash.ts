export function matchPromptSlash(value: string, cursor = value.length) {
  const match = value.slice(0, cursor).match(/(?:^|\s)\/(\S*)$/)
  if (!match) return
  const query = match[1] ?? ""
  return { query, start: cursor - query.length - 1, end: cursor }
}
