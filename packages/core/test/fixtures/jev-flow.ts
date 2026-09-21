import assert from "node:assert/strict"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { Jev } from "../../src/jev"
import { Auth } from "../../src/legacy-auth"
import { LayerNode } from "../../src/effect/layer-node"
import { Effect } from "effect"

const auth = LayerNode.compile(Auth.node)

const input = {
  sessionID: "test",
  text: "Fix a typo",
  agent: "build",
  auto: true,
  models: [{ providerID: "allowed", modelID: "fast" }],
}
const candidates = {
  models: [
    { providerID: "allowed", modelID: "fast", name: "Fast", description: "Simple work" },
    { providerID: "blocked", modelID: "other", name: "Other", description: "Not enabled" },
  ],
  skills: [
    { name: "editing", description: "Fix typos", content: "Check spelling", location: "/skills/editing/SKILL.md" },
  ],
}
let calls = 0
const transport: typeof fetch = Object.assign(
  async (_: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    calls++
    const body = JSON.parse(String(init?.body))
    if (body.questions.model) assert.deepEqual(Object.keys(body.questions.model.criteria), ["model0"])
    return Response.json({
      answers: Object.fromEntries(
        Object.entries(body.questions).map(([id, question]) => [
          id,
          (question as { type: string }).type === "choice"
            ? { type: "choice", choice: "model0", confidence: 0.95 }
            : { type: "score", score: 2, confidence: 0.95 },
        ]),
      ),
    })
  },
  { preconnect: fetch.preconnect },
)

assert.equal((await Jev.prepare(input, candidates, transport)).status, "disabled")
await mkdir(path.join(process.env.XDG_CONFIG_HOME!, "opencode"), { recursive: true })
await writeFile(path.join(process.env.XDG_CONFIG_HOME!, "opencode/jev.json"), JSON.stringify({ ...Jev.defaults, apiKey: "old-typesafe-test-key", openRouterKey: "obsolete-test-only-key" }), { mode: 0o600 })
assert.equal((await Jev.status()).configured, false)
await Jev.update({ ...Jev.defaults, enabled: true })
assert.equal((await Jev.prepare(input, candidates, transport)).status, "missing-key")
assert.equal(calls, 0)
await Effect.runPromise(Auth.Service.use((service) => service.set("openrouter", { type: "api", key: "test-only-not-a-real-key" })).pipe(Effect.provide(auth)))
assert.equal((await Jev.status()).configured, true)
assert.equal((await readFile(path.join(process.env.XDG_CONFIG_HOME!, "opencode/jev.json"), "utf8")).includes("Key"), false)
assert.equal((await stat(path.join(process.env.XDG_CONFIG_HOME!, "opencode/jev.json"))).mode & 0o777, 0o600)
assert.equal("apiKey" in (await Jev.status()), false)
assert.equal("openRouterKey" in (await Jev.status()), false)
const auto = await Jev.prepare(input, candidates, transport)
assert.deepEqual(auto.model, { providerID: "allowed", modelID: "fast" })
assert.equal(auto.skills[0].name, "editing")
assert.equal((await Jev.prepare({ ...input, auto: false }, candidates, transport)).model, undefined)
await Jev.update({ ...Jev.defaults, enabled: false })
assert.equal((await Jev.prepare(input, candidates, transport)).status, "disabled")
assert.equal(calls, 2)
await Jev.update({ ...Jev.defaults, enabled: true })
const variants = ["low", "high"].map((variant) => ({ ...candidates.models[0], variant }))
const routing: typeof fetch = Object.assign(async (_: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const body = JSON.parse(String(init?.body))
  assert.deepEqual(Object.keys(body.questions.model.criteria), ["model0", "model1"])
  assert.match(body.questions.model.criteria.model1, /high/)
  return Response.json({ answers: { model: { type: "choice", choice: "model1", confidence: 0.94 } } })
}, { preconnect: fetch.preconnect })
const routed = await Jev.prepare({ ...input, promptID: "msg_routing_test", models: variants }, { models: [...variants, candidates.models[1]], skills: [] }, routing)
assert.deepEqual(routed.model, { providerID: "allowed", modelID: "fast", variant: "high" })
assert.equal(routed.routing, "selected")
const child = await Jev.delegate(input.sessionID, "child", "Review authentication", "review", routing)
assert.deepEqual(child?.model, routed.model)
const history = await Jev.usage(input.sessionID)
assert.ok(history.some((entry) => entry.promptID === "msg_routing_test" && entry.decision?.selected?.variant === "high"))
const uncertain: typeof fetch = Object.assign(async () => Response.json({ answers: { model: { type: "choice", choice: "model0", confidence: 0.4 } } }), { preconnect: fetch.preconnect })
assert.equal((await Jev.prepare({ ...input, models: variants }, { models: variants, skills: [] }, uncertain)).routing, "uncertain")
await Jev.recordCompression(input.sessionID, 12000, 3000, true)
assert.ok((await Jev.usage(input.sessionID)).some((entry) => entry.automation?.cached && entry.automation.outputCharacters === 3000))
const explicit = await Jev.prepare({ ...input, auto: false, text: "Use $requested" }, {
  models: [],
  skills: [...Array.from({ length: 80 }, (_, index) => ({ ...candidates.skills[0], name: `other-${index}` })),
    { ...candidates.skills[0], name: "requested" }],
}, transport)
assert.equal(explicit.skills[0].name, "requested")
assert.equal(explicit.skills.length, 3)
assert.ok((await Jev.usage(input.sessionID)).some((entry) => entry.decision?.skills?.includes("requested") && entry.decision.skills.length === 3))
const ranking: typeof fetch = Object.assign(async (_: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const body = JSON.parse(String(init?.body))
  const values: string[] = body.state.chunks ?? body.state.findings ?? []
  return Response.json({ answers: Object.fromEntries(Object.keys(body.questions).map((id, index) => [id, {
    type: "score", score: values[index]?.includes("important") ? 2 : 0, confidence: 0.95,
  }])) })
}, { preconnect: fetch.preconnect })
const forced = await Jev.prepare({ ...input, auto: false, text: "$editing" }, candidates, ranking)
assert.equal(forced.skills[0].name, "editing")
const excerpts = await Jev.context("unrelated".padEnd(2000, ".") + "important".padEnd(2000, "."), input.sessionID, ranking)
assert.ok(excerpts?.startsWith("[Excerpt 2 of 2]"))
assert.ok(!excerpts?.includes("unrelated"))
assert.deepEqual(await Jev.prioritize(["minor", "important"], input.sessionID, ranking), ["important", "minor"])
const many = [...Array.from({ length: 35 }, (_, index) => `minor-${index}`), "important"]
const ordered = await Jev.prioritize(many, input.sessionID, ranking)
assert.equal(ordered[0], "important")
assert.deepEqual(new Set(ordered), new Set(many))
const failures = "FAIL minor\n  minor stack\nFAIL important\n  important stack\n2 failed"
const prioritized = await Jev.testFindings(failures, input.sessionID, ranking)
assert.ok(prioritized?.startsWith("Jev prioritized test failures:\nFAIL important\nFAIL minor"))
assert.ok(prioritized?.endsWith(failures))
const disabling: typeof fetch = Object.assign(
  async (...args: Parameters<typeof fetch>) => {
    await Jev.update({ ...Jev.defaults, enabled: false })
    return transport(...args)
  },
  { preconnect: fetch.preconnect },
)
const disabled = await Jev.prepare(input, candidates, disabling)
assert.equal(disabled.status, "disabled")
assert.equal(disabled.model, undefined)
assert.deepEqual(disabled.skills, [])
await Effect.runPromise(Auth.Service.use((service) => service.set("openrouter", { type: "api", key: "updated-test-only-key" })).pipe(Effect.provide(auth)))
await Jev.update({ ...Jev.defaults, enabled: true })
const updated: typeof fetch = Object.assign(async (_: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer updated-test-only-key")
  return Response.json({ answers: { skill: { type: "score", score: 2, confidence: 1 } } })
}, { preconnect: fetch.preconnect })
assert.ok(await Jev.evaluate("skills", {}, { skill: { type: "score", instructions: "test", criteria: ["No", "Maybe", "Yes"] } }, updated))
await Effect.runPromise(Auth.Service.use((service) => service.remove("openrouter")).pipe(Effect.provide(auth)))
assert.equal((await Jev.prepare(input, candidates, transport)).status, "missing-key")
assert.equal((await Jev.status()).configured, false)
