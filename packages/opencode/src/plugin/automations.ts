import type { Plugin } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { AutomaticChecks } from "@opencode-ai/core/automatic-checks"
import { Document } from "@opencode-ai/core/document"
import { Global } from "@opencode-ai/core/global"
import { Entire } from "@opencode-ai/core/entire"
import { Jev } from "@opencode-ai/core/jev"

export const AutomationsPlugin: Plugin = async ({ directory, worktree, client }) => {
  const baselines = new Map<string, Awaited<ReturnType<typeof AutomaticChecks.files>>>()
  const dirty = new Set<string>()
  const started = new Set<string>()
  let recording = Promise.resolve()
  const errors = new Set<string>()
  const baseline = async (sessionID: string) => {
    if (baselines.has(sessionID)) return
    const current = await AutomaticChecks.files(directory).catch(() => undefined)
    if (current) baselines.set(sessionID, current)
  }
  const report = async (message: string) => {
    if (errors.has(message)) return
    errors.add(message)
    await client.tui.showToast({ body: { title: "ArezaCode automation", message, variant: "error" } }).catch(() => {})
  }

  const entire = async (event: Parameters<typeof Entire.record>[0]["event"], sessionID: string, prompt?: string) => {
    if (!(await Entire.enabled(worktree))) return
    const [session, messages] = await Promise.all([
      client.session.get({ path: { id: sessionID }, throwOnError: true }),
      client.session.messages({ path: { id: sessionID }, throwOnError: true }),
    ])
    if (!session.data || !messages.data) throw new Error("Entire transcript export failed")
    await Entire.record({
      directory: worktree,
      event,
      prompt,
      transcript: { info: session.data, messages: messages.data },
    })
  }
  const record = (event: Parameters<typeof Entire.record>[0]["event"], sessionID: string, prompt?: string) => {
    recording = recording
      .then(() => entire(event, sessionID, prompt))
      .catch(() => report("Entire recording failed. This turn may not have a checkpoint."))
    return recording
  }

  return {
    "chat.message": async (input, output) => {
      await baseline(input.sessionID)
      for (const part of [...output.parts]) {
        if (part.type !== "file" || !Document.documentType(part.filename ?? "", part.mime)) continue
        const extracted = await (async () => {
          const url = new URL(part.url)
          if (url.protocol === "file:")
            return Document.convert({ path: fileURLToPath(url), name: part.filename ?? url.pathname, mime: part.mime })
          if (url.protocol !== "data:" || !part.url.slice(0, part.url.indexOf(",")).endsWith(";base64"))
            throw new Error("Document must be a local attachment")
          if (part.url.length > 28 * 1024 * 1024) throw new Error("Document exceeds the attachment size limit")
          return Document.convert({
            bytes: Buffer.from(part.url.slice(part.url.indexOf(",") + 1), "base64"),
            name: part.filename ?? "document",
            mime: part.mime,
          })
        })().catch(
          () =>
            `Document conversion failed for ${part.filename ?? "attachment"}. No text was extracted. Check that MarkItDown and the document's format dependencies are installed.`,
        )
        const ranked = await Jev.context(extracted, input.sessionID)
        const text = ranked ?? extracted
        const target = path.join(Global.Path.data, "tool-output", `tool_${randomUUID()}`)
        if (ranked || extracted.length > 50_000) {
          await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
          await writeFile(target, extracted, { mode: 0o600 })
        }
        output.parts.push({
          id: `prt_${randomUUID()}`,
          messageID: output.message.id,
          sessionID: input.sessionID,
          type: "text",
          synthetic: true,
          metadata: { convertedDocument: part.id },
          text: `Document: ${part.filename ?? "attachment"}\n${text.slice(0, 50_000)}${ranked || extracted.length > 50_000 ? `\nFull converted text: ${target}. Use Read for remaining content.` : ""}`,
        })
      }
      if (!started.has(input.sessionID)) {
        await record("session-start", input.sessionID)
        started.add(input.sessionID)
      }
      await record(
        "turn-start",
        input.sessionID,
        output.parts.flatMap((part) => (part.type === "text" && !part.synthetic ? [part.text] : [])).join("\n"),
      )
    },
    "tool.execute.before": async (input) => {
      await baseline(input.sessionID)
    },
    "tool.execute.after": async (input, output) => {
      dirty.add(input.sessionID)
      if (input.tool !== "bash" && input.tool !== "shell") return
      const ranked = await Jev.testFindings(output.output, input.sessionID)
      if (ranked) output.output = ranked
    },
    "experimental.chat.messages.transform": async (_, output) => {
      const current = output.messages.at(-1)
      if (!current || !dirty.delete(current.info.sessionID) || process.env.AREZACODE_SEMGREP === "0") return
      const sessionID = current.info.sessionID
      const notice = await (async () => {
        const before = baselines.get(sessionID)
        if (!before) return "Automatic Semgrep unavailable: this workspace has no readable Git baseline."
        const after = await AutomaticChecks.files(directory)
        const changed = new Map([...after.files].filter(([name, hash]) => before.files.get(name) !== hash))
        const findings = await AutomaticChecks.scan(after.root, changed, sessionID)
        baselines.set(sessionID, after)
        return findings
      })().catch(() => "Automatic Semgrep failed or is unavailable. These changes have not passed a security scan.")
      if (!notice) return
      const user = output.messages.findLast((message) => message.info.role === "user")
      if (user)
        user.parts.push({
          id: `prt_${randomUUID()}`,
          messageID: user.info.id,
          sessionID,
          type: "text",
          synthetic: true,
          text: notice,
        })
    },
    event: async ({ event }) => {
      if (event.type === "session.status" && event.properties.status.type === "idle")
        await record("turn-end", event.properties.sessionID)
      if (event.type === "session.compacted") await record("compaction", event.properties.sessionID)
      if (event.type === "session.deleted") {
        const id = event.properties.info.id
        baselines.delete(id)
        started.delete(id)
        dirty.delete(id)
      }
    },
    dispose: async () => {
      await recording
    },
  }
}
