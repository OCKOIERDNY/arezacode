import { expect, test } from "bun:test"
import { createOpencodeClient, type Part, type UserMessage } from "@opencode-ai/sdk"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { nativeCommand } from "@opencode-ai/core/util/native-command"
import { AutomationsPlugin } from "../../src/plugin/automations"

test("native hooks report attachment failures and scan a terminal edit before the next model call", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "areza-hook-test-"))
  try {
    await nativeCommand("git", ["init", "-q", directory])
    await nativeCommand(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "baseline"],
      { cwd: directory },
    )
    const hooks = await AutomationsPlugin({
      directory,
      worktree: directory,
      client: createOpencodeClient({ baseUrl: "http://127.0.0.1:1" }),
      project: { id: "test", worktree: directory, time: { created: 0 } },
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://127.0.0.1:1"),
      $: Bun.$,
    })
    const message: UserMessage = {
      id: "msg_test",
      sessionID: "ses_test",
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "test", modelID: "test" },
    }
    const parts: Part[] = [
      {
        id: "prt_file",
        messageID: message.id,
        sessionID: message.sessionID,
        type: "file",
        filename: "broken.pdf",
        mime: "application/pdf",
        url: "data:application/pdf;base64,YmFkaW5wdXQ=",
      },
    ]
    await hooks["chat.message"]!({ sessionID: message.sessionID }, { message, parts })
    expect(parts.some((part) => part.type === "text" && part.text.includes("conversion failed"))).toBe(true)
    expect(parts.some((part) => part.type === "text" && part.metadata?.convertedDocument === "prt_file")).toBe(true)
    await writeFile(
      path.join(directory, "unsafe.py"),
      "import subprocess\nfrom flask import request\nsubprocess.call(request.args.get('cmd'), shell=True)\n",
    )
    await hooks["tool.execute.after"]!(
      { sessionID: message.sessionID, callID: "call_test", tool: "bash", args: {} },
      { title: "Terminal edit", output: "", metadata: {} },
    )
    const history = { messages: [{ info: message, parts }] }
    await hooks["experimental.chat.messages.transform"]!({}, history)
    expect(parts.some((part) => part.type === "text" && part.text.includes("Automatic Semgrep findings"))).toBe(true)
    const count = parts.length
    await hooks["experimental.chat.messages.transform"]!({}, history)
    expect(parts.length).toBe(count)
    await hooks.dispose?.()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 180_000)
