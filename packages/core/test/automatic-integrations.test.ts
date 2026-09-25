import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { AutomaticChecks } from "../src/automatic-checks"
import { Jev } from "../src/jev"
import { Document } from "../src/document"
import { Entire } from "../src/entire"
import { engineStatus, engineAction, nativeBinary, nativeCommand } from "../src/util/native-command"
import { DateTime } from "effect"
import { SessionMessage } from "../src/session/message"
import { ModelV2 } from "../src/model"
import { ProviderV2 } from "../src/provider"

test("Ponytail blocks missing, stale, cross-session, and duplicate reuse evidence", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "areza-reuse-test-"))
  try {
    const target = path.join(directory, "new-feature.tsx")
    const owner = path.join(directory, "shared.tsx")
    const content = "export function SharedPanel() {\n" + Array.from({ length: 14 }, (_, index) => `  const label${index} = 'meaningful shared component content ${index}'`).join("\n") + "\n  return null\n}\n"
    await writeFile(owner, content)
    await expect(AutomaticChecks.guardReuse("session-a", target, "", content)).rejects.toThrow("reuse_check")
    await AutomaticChecks.rememberReuse("session-a", target, "", [{ path: owner, content }])
    await expect(AutomaticChecks.guardReuse("session-b", target, "", content)).rejects.toThrow("reuse_check")
    await expect(AutomaticChecks.guardReuse("session-a", target, "", content)).rejects.toThrow("Duplicate implementation")
    await expect(AutomaticChecks.guardReuse("session-a", target, "", content.replace("SharedPanel", "CopiedPanel"))).rejects.toThrow("Duplicate implementation")
    await AutomaticChecks.guardReuse("session-a", target, "", "export { SharedPanel } from './shared'\n")
    await writeFile(owner, content + "export const changed = true\n")
    await expect(AutomaticChecks.guardReuse("session-a", target, "", "export const fresh = true\n")).rejects.toThrow("evidence changed")
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test("MarkItDown converts a real DOCX, caches it, and rejects empty/corrupt documents", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "areza-document-test-"))
  try {
    const source = path.join(directory, "example.docx")
    const python = (await readFile(await nativeBinary("markitdown"), "utf8")).split("\n")[0].slice(2)
    await nativeCommand(python, [
      "-c",
      "import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n z.writestr('[Content_Types].xml','<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>')\n z.writestr('word/document.xml','<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>Automatic document conversion</w:t></w:r></w:p><w:p><w:r><w:t>The model did not invoke a converter.</w:t></w:r></w:p></w:body></w:document>')",
      source,
    ])
    const first = await Document.convert({ path: source, name: source })
    expect(first).toContain("Automatic document conversion")
    expect(first).toContain("The model did not invoke a converter.")
    expect(await Document.convert({ path: source, name: source })).toBe(first)
    expect(await Document.attachment({ uri: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${Buffer.from(await readFile(source)).toString("base64")}`, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", name: "example.docx" })).toContain("Full converted document:")
    expect(Document.page("first\nsecond\nthird", 2, 1)).toEqual({
      content: "second",
      offset: 2,
      truncated: true,
      next: 3,
    })
    await expect(Document.convert({ bytes: new Uint8Array(), name: "empty.docx" })).rejects.toThrow("empty")
    await expect(Document.convert({ bytes: Buffer.from("corrupt"), name: "corrupt.docx" })).rejects.toThrow("failed")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 90_000)

test("Semgrep detects terminal edits and rescans a corrected file", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "areza-scan-test-"))
  try {
    await nativeCommand("git", ["init", "-q", directory])
    expect((await AutomaticChecks.files(directory)).files.size).toBe(0)
    await nativeCommand(
      "git",
      [
        "-c",
        "user.name=Automation Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "--allow-empty",
        "-qm",
        "baseline",
      ],
      { cwd: directory },
    )
    const before = await AutomaticChecks.files(directory)
    expect(before.files.size).toBe(0)
    await nativeCommand(
      "git",
      ["-c", "user.name=Automation Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "next revision"],
      { cwd: directory },
    )
    const nextRevision = await AutomaticChecks.files(directory)
    expect(nextRevision.files.size).toBe(0)
    expect(nextRevision.revision).not.toBe(before.revision)
    await writeFile(
      path.join(directory, "unsafe.py"),
      "import subprocess\nfrom flask import request\ndef run():\n    subprocess.call(request.args.get('command'), shell=True)\n",
    )
    const dirty = await AutomaticChecks.files(directory)
    const findings = await AutomaticChecks.scan(dirty.root, dirty.files)
    expect(findings).toContain("unsafe.py")
    expect(findings).toContain("Automatic Semgrep findings")
    const replay = JSON.parse(await nativeCommand(process.execPath, ["-e", `
      import { AutomaticChecks } from ${JSON.stringify(path.resolve(import.meta.dir, "../src/automatic-checks.ts"))}
      import { engineStatus } from ${JSON.stringify(path.resolve(import.meta.dir, "../src/util/native-command.ts"))}
      const state = await AutomaticChecks.files(${JSON.stringify(directory)})
      const output = await AutomaticChecks.scan(state.root, state.files)
      console.log(JSON.stringify({ output, status: (await engineStatus()).find((item) => item.id === "semgrep") }))
    `]))
    expect(replay.output).toBe(findings)
    expect(replay.status.lastResult).toContain("Reused a complete scan")
    await writeFile(path.join(directory, "unsafe.py"), "print('safe')\n")
    const fixed = await AutomaticChecks.files(directory)
    expect(fixed.files.get("unsafe.py")).not.toBe(dirty.files.get("unsafe.py"))
    expect(await AutomaticChecks.scan(fixed.root, fixed.files)).toBe("")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 180_000)

test("Headroom compresses real output without provider routing or retrieval markers", async () => {
  const output = JSON.stringify(
    Array.from({ length: 300 }, (_, id) => ({ id, status: "healthy", details: "normal operation" })),
  )
  const sessionID = `ses_headroom_${crypto.randomUUID()}`
  const compressed = await AutomaticChecks.compress(output, undefined, sessionID)
  expect(compressed).toBeDefined()
  expect(compressed!.length).toBeLessThan(output.length)
  expect(compressed).not.toContain("<<ccr:")
  expect(await Jev.usage(sessionID)).toMatchObject([{ kind: "automation", automation: { name: "Headroom", inputCharacters: output.length, outputCharacters: compressed!.length }, finish: "compressed" }])
  const replay = JSON.parse(await nativeCommand(process.execPath, ["-e", `
    import { AutomaticChecks } from ${JSON.stringify(path.resolve(import.meta.dir, "../src/automatic-checks.ts"))}
    import { engineStatus } from ${JSON.stringify(path.resolve(import.meta.dir, "../src/util/native-command.ts"))}
    const output = await AutomaticChecks.compress(${JSON.stringify(output)})
    console.log(JSON.stringify({ output, status: (await engineStatus()).find((item) => item.id === "headroom") }))
  `]))
  expect(replay.output).toBe(compressed)
  expect(replay.status.lastResult).toContain("Reused compressed output")
  expect(await AutomaticChecks.compress("short output")).toBeUndefined()
}, 30_000)

test("native command failures and timeouts never become successful results", async () => {
  await expect(nativeCommand("/usr/bin/false", [])).rejects.toThrow("failed")
  await expect(nativeCommand("/bin/sleep", ["2"], { timeout: 20 })).rejects.toThrow("failed")
})

test("Entire records a native desktop turn without committing or pushing the working branch", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "areza-entire-test-"))
  try {
    await nativeCommand("git", ["init", "-q", directory])
    await nativeCommand("git", ["config", "user.name", "Automation Test"], { cwd: directory })
    await nativeCommand("git", ["config", "user.email", "test@example.invalid"], { cwd: directory })
    await writeFile(path.join(directory, "sample.txt"), "before\n")
    await nativeCommand("git", ["add", "sample.txt"], { cwd: directory })
    await nativeCommand("git", ["commit", "-qm", "baseline"], { cwd: directory })
    const before = await nativeCommand("git", ["rev-parse", "HEAD"], { cwd: directory })
    expect(await Entire.enabled(directory)).toBe(false)
    await nativeCommand(
      await nativeBinary("entire"),
      [
        "enable",
        "--agent",
        "opencode",
        "--local",
        "--skip-push-sessions",
        "--agent-help-skill=false",
        "--search-skill=false",
        "--telemetry=false",
        "--no-init-repo",
      ],
      { cwd: directory },
    )
    expect(await Entire.enabled(directory)).toBe(true)
    const sessionID = "ses_areza_native_test"
    const user = {
      info: { id: "msg_user", role: "user", time: { created: Date.now() } },
      parts: [{ type: "text", text: "Update sample.txt" }],
    }
    const transcript = { info: { id: sessionID }, messages: [user] }
    await Entire.record({ directory, event: "session-start", transcript })
    await Entire.record({ directory, event: "turn-start", prompt: "Update sample.txt", transcript })
    await writeFile(path.join(directory, "sample.txt"), "after\n")
    await Entire.record({
      directory,
      event: "turn-end",
      transcript: {
        info: transcript.info,
        messages: [
          user,
          {
            info: { id: "msg_assistant", role: "assistant", time: { created: Date.now(), completed: Date.now() } },
            parts: [
              {
                type: "tool",
                tool: "edit",
                state: {
                  status: "completed",
                  input: { filePath: path.join(directory, "sample.txt") },
                  output: "Updated",
                },
              },
            ],
          },
        ],
      },
    })
    expect(await nativeCommand("git", ["rev-parse", "HEAD"], { cwd: directory })).toBe(before)
    expect(
      await nativeCommand("git", ["for-each-ref", "--format=%(refname)", "refs/heads/entire"], { cwd: directory }),
    ).toContain("entire/")
    const exported = JSON.parse(await readFile(path.join(directory, ".entire/tmp", sessionID + ".json"), "utf8"))
    expect(exported.messages).toHaveLength(2)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)

test("V2 automations scan edits, clear corrected findings and record checkpoints without committing", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "areza-v2-automations-"))
  try {
    await nativeCommand("git", ["init", "-q", directory])
    await nativeCommand("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "baseline"], { cwd: directory })
    const head = await nativeCommand("git", ["rev-parse", "HEAD"], { cwd: directory })
    const automation = await AutomaticChecks.session(directory, "ses_v2_native")
    const context: SessionMessage.Message[] = [{ type: "user", id: SessionMessage.ID.make("msg_v2_native"), text: "Fix unsafe input", time: { created: DateTime.makeUnsafe(Date.now()) } }]
    await automation.before(context)
    await writeFile(path.join(directory, "unsafe.py"), "import subprocess\nfrom flask import request\ndef run():\n    subprocess.call(request.args.get('command'), shell=True)\n")
    await automation.after(context)
    expect(await automation.before(context)).toContain("unsafe.py")
    await writeFile(path.join(directory, "unsafe.py"), "print('safe')\n")
    context.push(SessionMessage.Assistant.make({
      id: SessionMessage.ID.make("msg_v2_assistant"), type: "assistant", agent: "build",
      model: { id: ModelV2.ID.make("test"), providerID: ProviderV2.ID.make("test") },
      time: { created: DateTime.makeUnsafe(Date.now()) },
      content: [SessionMessage.AssistantTool.make({ type: "tool", id: "edit", name: "edit",
        time: { created: DateTime.makeUnsafe(Date.now()) },
        state: SessionMessage.ToolStateCompleted.make({ status: "completed", input: { path: path.join(directory, "unsafe.py") }, content: [{ type: "text", text: "Fixed unsafe input" }], structured: {} }),
      })],
    }))
    await automation.after(context)
    expect(await automation.before(context)).not.toContain("Automatic Semgrep findings")
    await automation.finish(context)
    expect(await nativeCommand("git", ["rev-parse", "HEAD"], { cwd: directory })).toBe(head)
    expect(JSON.parse(await readFile(path.join(directory, ".entire/tmp/ses_v2_native.json"), "utf8")).messages[0].info.role).toBe("user")
    expect(JSON.parse(await readFile(path.join(directory, ".entire/tmp/ses_v2_native.json"), "utf8")).messages[1].parts[0].state.output).toBe("Fixed unsafe input")
    expect(await nativeCommand("git", ["for-each-ref", "--format=%(refname)", "refs/heads/entire"], { cwd: directory })).toContain("entire/")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 180_000)

test("Context7 is hosted, replaces Grounded Docs, and cancels requests", async () => {
  const engines = await engineStatus()
  expect(engines.some((item) => item.id === "context7" && item.installed && item.version === "remote")).toBe(true)
  expect(engines.some((item) => String(item.id) === "grounded")).toBe(false)
  await expect(engineAction("context7", "install")).rejects.toThrow("hosted tool")
  await expect(Document.context7("query-docs", { libraryId: "/solidjs/solid", query: "createMemo" }, AbortSignal.abort())).rejects.toThrow()
})
