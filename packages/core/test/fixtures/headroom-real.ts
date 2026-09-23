import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { AutomaticChecks } from "../../src/automatic-checks"
import { Global } from "../../src/global"

const python = process.env.AREZACODE_TEST_HEADROOM_PYTHON
assert.ok(python && path.isAbsolute(python))
const revision = `0.37.0-${crypto.randomUUID()}`
const directory = path.join(Global.Path.data, "engines/headroom", revision, "venv/bin")
await mkdir(directory, { recursive: true })
await writeFile(path.join(directory, "headroom"), `#!${python}\n`, { mode: 0o700 })
await writeFile(path.join(Global.Path.config, "engines.json"), JSON.stringify({ headroom: { enabled: true, current: revision } }))

const samples = {
  repeated: "Repeated status: the service is healthy and the request was successful.\n".repeat(300)
    + "ERROR: database transaction rolled back; do not retry payment automatically.\n",
  search: Array.from({ length: 300 }, (_, index) => `/project/packages/service/src/very-long-file-name.ts:${index + 1}:unique_match_${index}`).join("\n"),
  json: JSON.stringify(Array.from({ length: 300 }, (_, id) => ({ id, status: "ok", description: "Repeated status for a healthy service" })), null, 2),
}

for (const [name, text] of Object.entries(samples)) {
  const compressed = await AutomaticChecks.compress(text)
  assert.ok(compressed, name)
  assert.ok(compressed.length < text.length * 0.9, name)
  assert.ok(!compressed.includes("<<ccr:"), name)
  assert.equal(await AutomaticChecks.compress(text), compressed)
  if (name === "json") continue
  const child: Bun.Subprocess<"pipe", "pipe", "pipe"> = Bun.spawn([python, "-c", [
    "import json,sys",
    "from headroom.transforms.lossless_compaction import expand_runs,unfold_repeated_blocks,search_unheading,search_dir_unheading,path_unheading",
    "value=json.load(sys.stdin)",
    "text=value['compressed']",
    "candidates=[expand_runs(text),expand_runs(unfold_repeated_blocks(text)),search_unheading(text),search_dir_unheading(text),path_unheading(text)]",
    "assert value['original'] in candidates, 'Reversible Headroom fold lost content'",
  ].join("\n")], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  child.stdin.write(JSON.stringify({ original: text, compressed }))
  child.stdin.end()
  const error = await new Response(child.stderr).text()
  assert.equal(await child.exited, 0, error)
}
