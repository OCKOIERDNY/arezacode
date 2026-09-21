export * as Entire from "./entire"

import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises"
import path from "node:path"
import { Global } from "./global"
import { engineCommand, engineEnabled, engineEnvironment, nativeCommand } from "./util/native-command"
import type { SessionMessage } from "./session/message"
import { DateTime } from "effect"

const enabling = new Map<string, Promise<void>>()
export async function ensure(directory: string) {
  if (!(await engineEnabled("entire"))) return
  const root = await nativeCommand("git", ["rev-parse", "--show-toplevel"], { cwd: directory }).then((value) => value.trim()).catch(() => undefined)
  if (!root) return
  if (await stat(path.join(root, ".entire/settings.local.json")).catch(() => undefined) || await stat(path.join(root, ".entire/settings.json")).catch(() => undefined)) return
  const pending = enabling.get(root)
  if (pending) return pending
  const task = engineCommand("entire", ["enable", "--agent", "opencode", "--local", "--skip-push-sessions", "--agent-help-skill=false", "--search-skill=false", "--telemetry=false", "--no-init-repo"], { cwd: root }).then(() => {})
  enabling.set(root, task)
  return task.finally(() => enabling.delete(root))
}

export async function recordV2(directory: string, sessionID: string, event: Parameters<typeof record>[0]["event"], messages: readonly SessionMessage.Message[]) {
  return record({ directory, event,
    prompt: messages.findLast((message) => message.type === "user")?.text,
    transcript: { info: { id: sessionID }, messages: messages.flatMap((message) => {
      if (message.type !== "user" && message.type !== "assistant") return []
      return [{ info: { id: message.id, sessionID, role: message.type, time: { created: DateTime.toEpochMillis(message.time.created) } },
        parts: message.type === "user" ? [{ type: "text", text: message.text }] : message.content
          .filter((part) => part.type === "text" || part.type === "tool")
          .map((part) => part.type === "text" ? { type: "text", text: part.text } : {
            type: "tool", tool: part.name, state: part.state.status === "pending" ? part.state : {
              ...part.state, input: { ...part.state.input, filePath: part.state.input.filePath ?? part.state.input.path },
              ...(part.state.status === "completed" ? { output: part.state.content.filter((item) => item.type === "text").map((item) => item.text).join("\n") } : {}),
            },
          }) }]
    }) },
  })
}

export async function enabled(directory: string) {
  if (!(await engineEnabled("entire"))) return false
  const root = await nativeCommand("git", ["rev-parse", "--show-toplevel"], { cwd: directory }).then((value) => value.trim()).catch(() => directory)
  const shared: unknown = JSON.parse(
    await readFile(path.join(root, ".entire/settings.json"), "utf8").catch(() => "{}"),
  )
  const local: unknown = JSON.parse(
    await readFile(path.join(root, ".entire/settings.local.json"), "utf8").catch(() => "{}"),
  )
  if (local && typeof local === "object" && "enabled" in local) return local.enabled === true
  return Boolean(shared && typeof shared === "object" && "enabled" in shared && shared.enabled === true)
}

export async function record(input: {
  directory: string
  event: "session-start" | "turn-start" | "turn-end" | "compaction" | "session-end"
  transcript: { info: { id: string }; messages: readonly unknown[] }
  prompt?: string
}) {
  if (!(await enabled(input.directory))) return
  if (process.platform === "win32") throw new Error("Entire desktop recording currently requires macOS or Linux")
  const temporary = await mkdtemp(path.join(Global.Path.tmp, "entire-"))
  try {
    const transcript = path.join(temporary, "session.json")
    await writeFile(transcript, JSON.stringify(input.transcript), { mode: 0o600 })
    await writeFile(
      path.join(temporary, "opencode"),
      '#!/bin/sh\n[ "$1" = "export" ] && [ "$2" = "$AREZACODE_ENTIRE_SESSION" ] || exit 1\nexec /bin/cat "$AREZACODE_ENTIRE_TRANSCRIPT"\n',
      { mode: 0o700 },
    )
    await engineCommand("entire", ["hooks", "opencode", input.event], {
      cwd: input.directory,
      input: JSON.stringify({ session_id: input.transcript.info.id, prompt: input.prompt }),
      env: engineEnvironment({
        PATH: temporary + path.delimiter + (process.env.PATH ?? ""),
        AREZACODE_ENTIRE_SESSION: input.transcript.info.id,
        AREZACODE_ENTIRE_TRANSCRIPT: transcript,
      }),
    })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
