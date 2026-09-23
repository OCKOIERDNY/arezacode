import assert from "node:assert/strict"
import { Jev } from "../../src/jev"

const config = { ...Jev.defaults, enabled: true }
const text = "unrelated".padEnd(2000, ".") + "important".padEnd(2000, ".")
const selected = `[Excerpt 2 of 2]\n${text.slice(2000)}`
process.env.OPENROUTER_API_KEY = "test-only-not-a-real-key"
await Jev.update(config)
Jev.remember("context", "Inspect important behavior")

function transport(mode = "selected", gate?: Promise<void>, started?: () => void) {
  const state = { calls: 0 }
  const fetcher: typeof fetch = Object.assign(async (_: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    state.calls++
    started?.()
    await gate
    if (mode === "failure") return new Response("unavailable", { status: 503 })
    if (mode === "rejected") throw new Error("offline")
    if (mode === "malformed") return new Response("not-json")
    const body = JSON.parse(String(init?.body))
    assert.equal(body.model, "~typesafe/jev-latest")
    return Response.json({ answers: mode === "incomplete" ? {} : Object.fromEntries(Object.keys(body.questions).map((id, index) => [id, {
      type: "score",
      score: mode === "invalid" ? 10 : mode === "unchanged" ? 2 : mode === "empty" ? 0 : index === 0 ? 0 : 2,
      ...(mode === "missing-confidence" ? {} : { confidence: mode === "uncertain" ? 0.4 : 0.95 }),
    }])) })
  }, { preconnect: fetch.preconnect })
  return { state, fetcher }
}

const gate = Promise.withResolvers<void>()
const started = Promise.withResolvers<void>()
const first = transport("selected", gate.promise, () => started.resolve())
const concurrent = Array.from({ length: 6 }, () => Jev.context(text, "context", first.fetcher))
await started.promise
await Bun.sleep(30)
assert.equal(first.state.calls, 1)
gate.resolve()
assert.deepEqual(await Promise.all(concurrent), Array(6).fill(selected))
assert.equal(await Jev.context(text, "context", first.fetcher), selected)
Jev.remember("context", "Inspect important behavior")
assert.equal(await Jev.context(text, "context", first.fetcher), selected)
assert.equal(first.state.calls, 1)
assert.equal((await Jev.usage("context")).length, 1)

await Jev.context(text + "changed", "context", first.fetcher)
assert.equal(first.state.calls, 2)
Jev.remember("context", "A different task")
await Jev.context(text, "context", first.fetcher)
assert.equal(first.state.calls, 3)
Jev.remember("context", "long task".padEnd(8000, ".") + "first")
await Jev.context(text, "context", first.fetcher)
Jev.remember("context", "long task".padEnd(8000, ".") + "second")
await Jev.context(text, "context", first.fetcher)
assert.equal(first.state.calls, 5)
await Jev.guidance("context", "msg_new_prompt", 0)
await Jev.context(text, "context", first.fetcher)
assert.equal(first.state.calls, 6)
Jev.remember("other", "A different task")
await Jev.context(text, "other", first.fetcher)
assert.equal(first.state.calls, 7)
const otherTransport = transport()
await Jev.context(text, "context", otherTransport.fetcher)
assert.equal(otherTransport.state.calls, 1)
await Jev.context(text, "context", otherTransport.fetcher)
assert.equal(otherTransport.state.calls, 1)
process.env.OPENROUTER_API_KEY = "changed-test-only-key"
await Jev.context(text, "context", otherTransport.fetcher)
assert.equal(otherTransport.state.calls, 2)
await Jev.update({ ...config, findings: false })
await Jev.context(text, "context", otherTransport.fetcher)
assert.equal(otherTransport.state.calls, 3)
await Jev.update({ ...config, context: false })
assert.equal(await Jev.context(text, "context", otherTransport.fetcher), undefined)
assert.equal(otherTransport.state.calls, 3)
await Jev.update(config)
assert.equal(await Jev.context(text, "context", otherTransport.fetcher), selected)
assert.equal(otherTransport.state.calls, 4)
await Jev.update({ ...config, enabled: false })
assert.equal(await Jev.context(text, "context", otherTransport.fetcher), undefined)
assert.equal(otherTransport.state.calls, 4)
await Jev.update(config)
Jev.remember("context", "A different task")
assert.equal(await Jev.context(text, "context", otherTransport.fetcher), selected)
assert.equal(otherTransport.state.calls, 5)

for (const mode of ["unchanged", "empty"]) {
  const current = transport(mode)
  assert.equal(await Jev.context(text, "context", current.fetcher), undefined)
  assert.equal(await Jev.context(text, "context", current.fetcher), undefined)
  assert.equal(current.state.calls, 1, mode)
}
for (const mode of ["failure", "rejected", "malformed", "incomplete", "invalid", "uncertain", "missing-confidence"]) {
  const current = transport(mode)
  assert.equal(await Jev.context(text, "context", current.fetcher), undefined)
  assert.equal(await Jev.context(text, "context", current.fetcher), undefined)
  assert.equal(current.state.calls, 2, mode)
}
let synchronousFailures = 0
const synchronous: typeof fetch = Object.assign(() => {
  synchronousFailures++
  throw new Error("synchronous transport failure")
}, { preconnect: fetch.preconnect })
assert.equal(await Jev.context(text, "context", synchronous), undefined)
assert.equal(await Jev.context(text, "context", synchronous), undefined)
assert.equal(synchronousFailures, 2)

for (const change of ["disable", "task", "prompt"]) {
  const gate = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  const current = transport("selected", gate.promise, () => started.resolve())
  const pending = Jev.context(text, "context", current.fetcher)
  await started.promise
  if (change === "disable") {
    await Jev.update({ ...config, context: false })
    await Jev.update(config)
  }
  if (change === "task") Jev.remember("context", "Changed during the request")
  if (change === "prompt") await Jev.guidance("context", "msg_changed_during_request", 0)
  gate.resolve()
  assert.equal(await pending, undefined, change)
  assert.equal(await Jev.context(text, "context", current.fetcher), selected)
  assert.equal(current.state.calls, 2, change)
}

const bounded = transport()
await Jev.context(text, "context", bounded.fetcher)
for (let index = 0; index < 100; index++) await Jev.context(text + index, "context", bounded.fetcher)
await Jev.context(text, "context", bounded.fetcher)
assert.equal(bounded.state.calls, 102)
const failures = "FAIL minor\n  minor stack\nFAIL important\n  required assertion\n" + "diagnostic context\n".repeat(200)
const findings = transport()
const ranked = await Jev.context(failures, "context", findings.fetcher)
assert.ok(ranked)
assert.ok(ranked.endsWith(failures))
assert.match(ranked, /^Jev prioritized test failures:/)
await Jev.context(failures, "context", findings.fetcher)
assert.equal(findings.state.calls, 2)
const noKey = transport()
process.env.OPENROUTER_API_KEY = ""
assert.equal(await Jev.context(text, "context", noKey.fetcher), undefined)
assert.equal(noKey.state.calls, 0)
process.env.OPENROUTER_API_KEY = "test-only-not-a-real-key"
assert.equal(await Jev.context(text, "context", noKey.fetcher), selected)
assert.equal(noKey.state.calls, 1)
