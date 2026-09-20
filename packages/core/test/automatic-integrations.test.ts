import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { AutomaticChecks } from "../src/automatic-checks"
import { Document } from "../src/document"
import { Entire } from "../src/entire"
import { nativeBinary, nativeCommand } from "../src/util/native-command"

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
    await writeFile(
      path.join(directory, "unsafe.py"),
      "import subprocess\nfrom flask import request\ndef run():\n    subprocess.call(request.args.get('command'), shell=True)\n",
    )
    const dirty = await AutomaticChecks.files(directory)
    const findings = await AutomaticChecks.scan(dirty.root, dirty.files)
    expect(findings).toContain("unsafe.py")
    expect(findings).toContain("Automatic Semgrep findings")
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
  const compressed = await AutomaticChecks.compress(output)
  expect(compressed).toBeDefined()
  expect(compressed!.length).toBeLessThan(output.length)
  expect(compressed).not.toContain("<<ccr:")
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
