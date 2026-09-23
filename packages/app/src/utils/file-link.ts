import { stripQueryAndHash } from "@/context/file/path"

export function fileLinkPath(href: string, source?: string) {
  const value = href.trim()
  if (!value || /^[#?]/.test(value) || value.startsWith("//")) return
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^file:\/\//i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return
  const path = stripQueryAndHash(value)
  if (!path) return
  if (/^(?:file:\/\/|\/|[a-z]:[\\/])/i.test(path) || !source) return path
  const directory = source.slice(0, source.lastIndexOf("/") + 1)
  return `${directory}${path}`
}

export function openMarkdownFileLink(event: MouseEvent, open: (path: string) => void, source?: string) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return false
  if (!(event.target instanceof Element)) return false
  const link = event.target.closest<HTMLAnchorElement>("a[href]")
  if (!link?.closest('[data-component="markdown"]')) return false
  const path = fileLinkPath(link.getAttribute("href") ?? "", source)
  if (!path) return false
  event.preventDefault()
  event.stopImmediatePropagation()
  open(path)
  return true
}
