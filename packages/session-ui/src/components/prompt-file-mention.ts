import type { FilePartSource } from "@opencode-ai/sdk/v2/client"

export function writeFileMention(element: HTMLElement, part: {
  path: string
  mime?: string
  filename?: string
  url?: string
  source?: FilePartSource
}) {
  element.dataset.path = part.path
  if (part.mime) element.dataset.mime = part.mime
  if (part.filename) element.dataset.filename = part.filename
  if (part.url) element.dataset.url = part.url
  if (part.source?.type !== "resource") return
  element.dataset.sourceType = part.source.type
  element.dataset.sourceClientName = part.source.clientName
  element.dataset.sourceUri = part.source.uri
}

export function readFileMention(element: HTMLElement, start: number) {
  const content = element.textContent ?? ""
  const end = start + content.length
  const source =
    element.dataset.sourceType === "resource" && element.dataset.sourceClientName && element.dataset.sourceUri
      ? {
          type: "resource" as const,
          text: { value: content, start, end },
          clientName: element.dataset.sourceClientName,
          uri: element.dataset.sourceUri,
        }
      : undefined
  return {
    type: "file" as const,
    path: element.dataset.path ?? content.slice(1),
    content,
    start,
    end,
    ...(element.dataset.mime ? { mime: element.dataset.mime } : {}),
    ...(element.dataset.filename ? { filename: element.dataset.filename } : {}),
    ...(element.dataset.url ? { url: element.dataset.url } : {}),
    ...(source ? { source } : {}),
  }
}
