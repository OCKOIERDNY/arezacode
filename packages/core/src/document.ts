export * as Document from "./document"

import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { documentType } from "@opencode-ai/schema/document"
import { Global } from "./global"
import { engineCommand, engineEnabled, nativeBinary } from "./util/native-command"
import { Jev } from "./jev"
import { fileURLToPath } from "node:url"
import type { FileAttachment } from "./session/prompt"

export { documentType }

const pending = new Map<string, Promise<string>>()
const maxBytes = 20 * 1024 * 1024

export async function convert(input: {
  path?: string
  bytes?: Uint8Array
  name: string
  mime?: string
  signal?: AbortSignal
}) {
  if (!(await engineEnabled("markitdown"))) throw new Error("MarkItDown is disabled")
  const type = documentType(input.name, input.mime)
  if (!type) throw new Error("Unsupported document format")
  if (input.path && (await stat(input.path)).size > maxBytes)
    throw new Error("Document exceeds the 20 MiB conversion limit")
  const bytes = input.bytes ?? (input.path ? await readFile(input.path) : undefined)
  if (!bytes?.length || bytes.length > maxBytes)
    throw new Error("Document is empty or exceeds the 20 MiB conversion limit")
  const signature = Buffer.from(bytes.subarray(0, 8))
  const valid =
    type.extension === "pdf"
      ? signature.subarray(0, 5).toString() === "%PDF-"
      : type.extension === "xls"
        ? signature.toString("hex") === "d0cf11e0a1b11ae1"
        : signature.subarray(0, 4).toString("hex") === "504b0304"
  if (!valid) throw new Error("Document conversion failed: file contents do not match its format")
  const binary = await nativeBinary("markitdown")
  const version = await stat(binary)
  const hash = createHash("sha256").update(bytes).update(`${type.extension}:${binary}:${version.mtimeMs}`).digest("hex")
  const directory = path.join(Global.Path.cache, "document-text")
  const target = path.join(directory, hash + ".txt")
  const cached = await readFile(target, "utf8").catch(() => undefined)
  if (cached) return cached
  const running = pending.get(hash)
  if (running) return running
  const task = (async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temporary = await mkdtemp(path.join(directory, "convert-"))
    try {
      const source = path.join(temporary, `source.${type.extension}`)
      await writeFile(source, bytes, { mode: 0o600 })
      const text = await engineCommand("markitdown", [source], { signal: input.signal, timeout: 60_000 })
      if (!text.trim()) throw new Error("MarkItDown extracted no text; this document may require OCR")
      const output = path.join(temporary, "output.txt")
      await writeFile(output, text, { mode: 0o600 })
      await rename(output, target)
      return text
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  })()
  pending.set(hash, task)
  return task.finally(() => pending.delete(hash))
}

export async function attachment(file: FileAttachment, signal?: AbortSignal, sessionID?: string) {
  const url = new URL(file.uri)
  if (url.protocol !== "file:" && url.protocol !== "data:") throw new Error("Document attachment must be a local file or uploaded data")
  if (file.uri.length > 28 * 1024 * 1024) throw new Error("Attachment exceeds the size limit")
  if (url.protocol === "data:" && !file.uri.slice(0, file.uri.indexOf(",")).endsWith(";base64")) throw new Error("Invalid document attachment encoding")
  const text = await convert({
    name: file.name ?? url.pathname,
    mime: file.mime,
    ...(url.protocol === "file:" ? { path: fileURLToPath(url) } : { bytes: Buffer.from(file.uri.slice(file.uri.indexOf(",") + 1), "base64") }),
    signal,
  })
  const output = path.join(Global.Path.data, "tool-output", `document-${createHash("sha256").update(text).digest("hex")}.txt`)
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, text, { mode: 0o600 })
  const ranked = await Jev.context(text, sessionID)
  return `Document: ${file.name ?? "attachment"}\n${(ranked ?? text).slice(0, 30_000)}\nFull converted document: ${output}`
}

export async function context7(name: "resolve-library-id" | "query-docs", input: Record<string, string>, signal?: AbortSignal) {
  if (!(await engineEnabled("context7"))) throw new Error("Context7 is disabled")
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js")
  const client = new Client({ name: "ArezaCode", version: "1.0.0" })
  const timeout = AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])])
  const transport = new StreamableHTTPClientTransport(new URL("https://mcp.context7.com/mcp"), { requestInit: { signal: timeout } })
  try {
    await client.connect(transport, { signal: timeout, timeout: 30_000 })
    const result = await client.callTool({ name, arguments: input }, undefined, { signal: timeout, timeout: 30_000 })
    const text = result.content.flatMap((item) => item.type === "text" ? [item.text] : []).join("\n\n")
    if (result.isError) throw new Error(text || "Context7 request failed")
    if (!text) throw new Error("Context7 returned no documentation")
    return text
  } finally {
    await client.close()
  }
}

export function page(text: string, offset = 1, limit = 2000) {
  const lines = text.split("\n")
  if (offset < 1 || offset > lines.length) throw new Error("Document line offset is out of range")
  const selected = lines.slice(offset - 1, offset - 1 + Math.max(1, Math.min(limit, 2000)))
  const content = selected.join("\n").slice(0, 50 * 1024)
  const count = content.split("\n").length
  const truncated = content.length < selected.join("\n").length || offset - 1 + count < lines.length
  return { content, offset, truncated, next: truncated ? offset + count : undefined }
}
