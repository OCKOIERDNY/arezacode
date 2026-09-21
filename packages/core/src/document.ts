export * as Document from "./document"

import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { documentType } from "@opencode-ai/schema/document"
import { Global } from "./global"
import { engineCommand, engineEnabled, nativeBinary } from "./util/native-command"
import { Jev } from "./jev"
import { Integration } from "@opencode-ai/schema/integration"
import { Schema } from "effect"
import { fileURLToPath } from "node:url"
import { lookup } from "node:dns/promises"
import { BlockList, isIP } from "node:net"
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

const docsRoot = path.join(Global.Path.data, "grounded-docs")
const docsFile = path.join(docsRoot, "sources.json")
const Source = Schema.Struct({ ...Integration.DocsSource.fields, indexedAt: Schema.Number.pipe(Schema.optional), error: Schema.String.pipe(Schema.optional) })
let docsWriting = Promise.resolve()
const privateNetworks = new BlockList()
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const)
  privateNetworks.addSubnet(address, prefix)
privateNetworks.addSubnet("2001:db8::", 32, "ipv6")

export async function docsSources() {
  return Schema.decodeUnknownSync(Schema.Array(Source))(
    Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(await readFile(docsFile, "utf8").catch(() => "[]")),
  )
}

export async function docsSearch(input: typeof Integration.DocsQuery.Type, signal?: AbortSignal) {
  const query = Schema.decodeUnknownSync(Integration.DocsQuery)(input)
  const source = (await docsSources()).find((item) => item.library === query.library && item.version === query.version && item.indexedAt && !item.error)
  if (!source) throw new Error("This documentation version has not been indexed. Add its official source in Settings > Tools.")
  return docsCommand(["search", query.library, ` ${query.query}`, "--version", query.version, "--exact-match", "--limit", "5", "--output", "json"], signal)
}

export function docsIndex(input: typeof Integration.DocsSource.Type, remove = false, signal?: AbortSignal) {
  const source = Schema.decodeUnknownSync(Integration.DocsSource)(input)
  const task = docsWriting.catch(() => {}).then(async () => {
    signal?.throwIfAborted()
    if (!remove) {
      const url = new URL(source.url)
      if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") throw new Error("Documentation must use a public HTTPS URL")
      const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true })
      if (!addresses.length || addresses.some(({ address }) => isIP(address) === 6
        ? !/^[23]/.test(address) || privateNetworks.check(address, "ipv6")
        : privateNetworks.check(address))) throw new Error("Private documentation hosts are not permitted")
    }
    const sources = await docsSources()
    const remaining = sources.filter((item) => item.library !== source.library || item.version !== source.version)
    await mkdir(docsRoot, { recursive: true })
    const temporary = `${docsFile}.${Date.now()}.tmp`
    await writeFile(temporary, JSON.stringify(remove ? remaining : [...remaining, { ...source, error: "Indexing incomplete. Refresh this source to retry." }]), { mode: 0o600 })
    await rename(temporary, docsFile)
    const result = await docsCommand(remove
      ? ["remove", source.library, "--version", source.version]
      : ["scrape", source.library, source.url, "--version", source.version, "--max-pages", "100", "--max-depth", "3", "--scope", "subpages"], signal)
    await writeFile(temporary, JSON.stringify(remove ? remaining : [...remaining, { ...source, indexedAt: Date.now() }]), { mode: 0o600 })
    await rename(temporary, docsFile)
    return result
  })
  docsWriting = task.then(() => {}, () => {})
  return task
}

function docsCommand(args: string[], signal?: AbortSignal) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    ["PATH", "HOME", "TMPDIR", "LANG", "SYSTEMROOT"].includes(key)))
  return engineCommand("grounded", [...args, "--store-path", path.join(docsRoot, "index"), "--no-telemetry", "--no-logo"], {
    cwd: docsRoot,
    env: { ...env, DOCS_MCP_TELEMETRY: "false", DOCS_MCP_EMBEDDING_MODEL: "", DOCS_MCP_SCRAPER_SECURITY_NETWORK_ALLOW_PRIVATE_NETWORKS: "false" },
    timeout: args[0] === "scrape" ? 300_000 : 30_000,
    signal,
  })
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
