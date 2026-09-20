export * as Document from "./document"

import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { documentType } from "@opencode-ai/schema/document"
import { Global } from "./global"
import { nativeBinary, nativeCommand } from "./util/native-command"

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
      const text = await nativeCommand(binary, [source], { signal: input.signal, timeout: 60_000 })
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

export function page(text: string, offset = 1, limit = 2000) {
  const lines = text.split("\n")
  if (offset < 1 || offset > lines.length) throw new Error("Document line offset is out of range")
  const selected = lines.slice(offset - 1, offset - 1 + Math.max(1, Math.min(limit, 2000)))
  const content = selected.join("\n").slice(0, 50 * 1024)
  const count = content.split("\n").length
  const truncated = content.length < selected.join("\n").length || offset - 1 + count < lines.length
  return { content, offset, truncated, next: truncated ? offset + count : undefined }
}
