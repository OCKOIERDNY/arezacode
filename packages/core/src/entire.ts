export * as Entire from "./entire"

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { Global } from "./global"
import { nativeBinary, nativeCommand } from "./util/native-command"

export async function enabled(directory: string) {
  const shared: unknown = JSON.parse(
    await readFile(path.join(directory, ".entire/settings.json"), "utf8").catch(() => "{}"),
  )
  const local: unknown = JSON.parse(
    await readFile(path.join(directory, ".entire/settings.local.json"), "utf8").catch(() => "{}"),
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
  const binary = await nativeBinary("entire")
  const temporary = await mkdtemp(path.join(Global.Path.tmp, "entire-"))
  try {
    const transcript = path.join(temporary, "session.json")
    await writeFile(transcript, JSON.stringify(input.transcript), { mode: 0o600 })
    await writeFile(
      path.join(temporary, "opencode"),
      '#!/bin/sh\n[ "$1" = "export" ] && [ "$2" = "$AREZACODE_ENTIRE_SESSION" ] || exit 1\nexec /bin/cat "$AREZACODE_ENTIRE_TRANSCRIPT"\n',
      { mode: 0o700 },
    )
    await nativeCommand(binary, ["hooks", "opencode", input.event], {
      cwd: input.directory,
      input: JSON.stringify({ session_id: input.transcript.info.id, prompt: input.prompt }),
      env: {
        ...process.env,
        PATH: temporary + path.delimiter + (process.env.PATH ?? ""),
        AREZACODE_ENTIRE_SESSION: input.transcript.info.id,
        AREZACODE_ENTIRE_TRANSCRIPT: transcript,
      },
    })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
