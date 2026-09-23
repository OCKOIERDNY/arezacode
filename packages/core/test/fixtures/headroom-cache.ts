import assert from "node:assert/strict"
import { mkdir, readFile, readdir, utimes, writeFile } from "node:fs/promises"
import path from "node:path"
import { DateTime } from "effect"
import { AutomaticChecks } from "../../src/automatic-checks"
import { Global } from "../../src/global"
import { Jev } from "../../src/jev"
import { engineAction } from "../../src/util/native-command"

const text = "unchanged".padEnd(10_000, ".")
const log = path.join(Global.Path.data, "headroom-calls")
const calls = async () => (await readFile(log, "utf8").catch(() => "")).split("\n").length - 1

async function main() {
  if (process.argv[2] === "replay") {
    assert.equal(await AutomaticChecks.compress(text), undefined)
    return
  }
  const revision = `0.37.0-${crypto.randomUUID()}`
  const directory = path.join(Global.Path.data, "engines/headroom", revision, "venv/bin")
  await mkdir(directory, { recursive: true })
  const python = path.join(directory, "python-fake")
  const executable = path.join(directory, "headroom")
  await writeFile(python, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(import.meta.dir, "fake-headroom.ts"))} ${JSON.stringify(log)}\n`, { mode: 0o700 })
  await writeFile(executable, `#!${python}\n`, { mode: 0o700 })
  await writeFile(path.join(Global.Path.config, "engines.json"), JSON.stringify({ headroom: { enabled: true, current: revision } }))

  const started = Date.now()
  assert.equal(await AutomaticChecks.compress(text, undefined, "timing"), undefined)
  const finished = Date.now()
  assert.equal(await calls(), 1)
  assert.equal(await AutomaticChecks.compress(text, undefined, "cached"), undefined)
  assert.equal(await calls(), 1)
  const first = (await Jev.usage("timing"))[0]
  assert.deepEqual(first.automation, { name: "Headroom", inputCharacters: 10_000, outputCharacters: 10_000, cached: false })
  assert.equal(first.finish, "unchanged")
  assert.ok(DateTime.toEpochMillis(first.time.created) >= started)
  assert.ok(first.time.completed)
  assert.ok(DateTime.toEpochMillis(first.time.completed) <= finished)
  assert.ok(DateTime.toEpochMillis(first.time.completed) - DateTime.toEpochMillis(first.time.created) >= 40)
  const hit = (await Jev.usage("cached"))[0]
  assert.equal(hit.finish, "unchanged")
  assert.equal(hit.automation?.cached, true)
  assert.equal(hit.automation?.outputCharacters, text.length)
  assert.match(JSON.parse(await readFile(path.join(Global.Path.data, "engines/last-results.json"), "utf8")).headroom.lastResult, /Reused unchanged output/)
  const child = Bun.spawn([process.execPath, import.meta.filename, "replay"], { stdout: "pipe", stderr: "pipe" })
  assert.equal(await child.exited, 0, await new Response(child.stderr).text())
  assert.equal(await calls(), 1)

  const cache = path.join(Global.Path.cache, "mechanical/headroom")
  const entry = path.join(cache, (await readdir(cache))[0])
  assert.equal(await readFile(entry, "utf8"), "")
  await utimes(entry, new Date(0), new Date(0))
  await AutomaticChecks.compress(text)
  assert.equal(await calls(), 2)
  await AutomaticChecks.compress(text + "changed")
  assert.equal(await calls(), 3)
  await writeFile(executable, `#!${python}\nupdated\n`, { mode: 0o700 })
  await AutomaticChecks.compress(text)
  assert.equal(await calls(), 4)
  await engineAction("headroom", "disable")
  assert.equal(await AutomaticChecks.compress(text), undefined)
  assert.equal(await calls(), 4)
  await engineAction("headroom", "enable")
  await AutomaticChecks.compress(text)
  assert.equal(await calls(), 4)
  process.env.AREZACODE_HEADROOM = "0"
  assert.equal(await AutomaticChecks.compress("compressed".padEnd(10_000, ".")), undefined)
  assert.equal(await calls(), 4)
  process.env.AREZACODE_HEADROOM = "1"

  const compressed = "compressed".padEnd(10_000, ".")
  assert.equal(await AutomaticChecks.compress(compressed), compressed.slice(0, 8900))
  assert.equal(await AutomaticChecks.compress(compressed), compressed.slice(0, 8900))
  assert.equal(await calls(), 5)
  assert.equal(await AutomaticChecks.compress("boundary".padEnd(10_000, ".")), undefined)
  assert.equal(await AutomaticChecks.compress("boundary".padEnd(10_000, ".")), undefined)
  assert.equal(await calls(), 6)
  for (const mode of ["failure", "malformed", "invalid", "retrieval", "blank"]) {
    const before = await calls()
    for (const _ of [0, 1]) {
      const input = mode.padEnd(10_000, ".")
      if (mode === "failure" || mode === "malformed") await assert.rejects(AutomaticChecks.compress(input))
      else assert.equal(await AutomaticChecks.compress(input), undefined)
    }
    assert.equal(await calls(), before + 2, mode)
  }
  const before = await calls()
  await assert.rejects(AutomaticChecks.compress(text, AbortSignal.abort()))
  assert.equal(await calls(), before)
  const controller = new AbortController()
  const cancelled = assert.rejects(AutomaticChecks.compress("cancel".padEnd(10_000, "."), controller.signal, "cancelled"))
  while (await calls() === before) await Bun.sleep(5)
  controller.abort()
  await cancelled
  assert.deepEqual(await Jev.usage("cancelled"), [])
  assert.equal(await AutomaticChecks.compress("cancel".padEnd(10_000, ".")), undefined)
  assert.equal(await calls(), before + 2)
  await Promise.all(Array.from({ length: 201 }, (_, index) => writeFile(path.join(cache, index.toString(16).padStart(64, "0")), "")))
  await AutomaticChecks.compress(text + "bounded")
  assert.ok((await readdir(cache)).length <= 200)
}

await main()
