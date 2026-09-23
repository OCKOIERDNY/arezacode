import { expect, test } from "bun:test"
import { DateTime, Effect, Layer, Schema } from "effect"
import { eq, sql } from "drizzle-orm"
import { SessionHealth } from "../src/session/health"
import { SessionHandoff } from "../src/session/handoff"
import { SessionV2 } from "../src/session"
import { SessionInput } from "../src/session/input"
import { SessionMessage } from "../src/session/message"
import { SessionEvent } from "../src/session/event"
import { SessionExecution } from "../src/session/execution"
import { SessionProjector } from "../src/session/projector"
import { Database } from "../src/database/database"
import { EventV2 } from "../src/event"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { Project } from "../src/project"
import { ProjectTable } from "../src/project/sql"
import { AbsolutePath } from "../src/schema"
import { MessageID, PartID, SessionV1 } from "../src/v1/session"
import { MessageTable, PartTable, SessionMessageTable, SessionTable, TodoTable } from "../src/session/sql"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node, SessionProjector.node, SessionV2.node]), [
  [SessionExecution.node, Layer.succeed(SessionExecution.Service, SessionExecution.Service.of({
    withIdle: (_keys, effect) => Effect.as(effect, true),
    active: Effect.succeed(new Set<SessionV2.ID>()),
    resume: () => Effect.void,
    interrupt: () => Effect.void,
    wake: () => Effect.void,
  }))],
]))

const setup = Effect.gen(function* () {
  const database = yield* Database.Service
  const id = SessionV2.ID.create()
  yield* database.db.insert(ProjectTable).values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] }).onConflictDoNothing().run().pipe(Effect.orDie)
  yield* database.db.insert(SessionTable).values({ id, project_id: Project.ID.global, slug: "health", directory: "/project", title: "Context handoff", version: "test", metadata: { approvalMode: "auto", unrelated: "preserve" } }).run().pipe(Effect.orDie)
  return { db: database.db, id }
})

const legacy = (input: { db: Database.Interface["db"]; id: SessionV2.ID }, tokens = 250_000) => input.db.insert(MessageTable).values({
  id: MessageID.ascending(), session_id: input.id, time_created: 10,
  data: Schema.decodeUnknownSync(SessionV1.Assistant)({ id: MessageID.ascending(), sessionID: input.id, role: "assistant", parentID: MessageID.ascending(), agent: "build", mode: "build", path: { cwd: "/project", root: "/project" }, time: { created: 10 }, cost: 0, modelID: "test", providerID: "test", tokens: { input: tokens - 100_000, output: 10, reasoning: 0, cache: { read: 90_000, write: 10_000 } } }),
}).run().pipe(Effect.orDie)

test("inclusive INPUT policy handles below, at, above and smaller model caps", () => {
  expect(SessionHealth.limit()).toBe(250_000)
  expect(SessionHealth.limit(1_000_000)).toBe(250_000)
  expect(SessionHealth.limit(32_768)).toBe(26_214)
  expect(SessionHealth.inclusiveInput({ input: 20, cache: { read: 30, write: 40 } })).toBe(90)
})

test("health schema omits absent fields", () => {
  const encoded = Schema.encodeSync(SessionHealth.Info)({ sessionID: SessionV2.ID.create(), limit: 250_000, locked: false, inputTokens: undefined, lockedAt: undefined })
  expect(encoded).not.toHaveProperty("inputTokens")
  expect(encoded).not.toHaveProperty("lockedAt")
})

for (const tokens of [249_999, 250_000, 250_001]) {
  it.effect(`lazily recognizes legacy inclusive input ${tokens}`, () => Effect.gen(function* () {
    const input = yield* setup
    yield* legacy(input, tokens)
    const info = yield* SessionHealth.get(input.db, input.id)
    expect(info.inputTokens).toBe(tokens)
    expect(info.locked).toBe(tokens >= 250_000)
  }))
}

it.effect("native usage is already inclusive and ignores cumulative session totals", () => Effect.gen(function* () {
  const input = yield* setup
  yield* input.db.update(SessionTable).set({ tokens_input: 5_000_000 }).where(eq(SessionTable.id, input.id)).run().pipe(Effect.orDie)
  yield* input.db.insert(SessionMessageTable).values({ id: SessionMessage.ID.create(), session_id: input.id, type: "assistant", seq: 1, data: Schema.encodeSync(SessionMessage.Assistant)(Schema.decodeUnknownSync(SessionMessage.Assistant)({
    id: SessionMessage.ID.create(), type: "assistant", agent: "build", content: [], time: { created: 1 },
    usage: { version: 1, input: 249_999, cacheRead: 100_000, cacheWrite: 50_000, costSource: "unknown" },
    model: { id: "test", providerID: "test" },
  })) }).run().pipe(Effect.orDie)
  expect(yield* SessionHealth.get(input.db, input.id)).toMatchObject({ inputTokens: 249_999, locked: false })
  expect(yield* SessionHealth.get(input.db, input.id, 100_000)).toMatchObject({ limit: 80_000, locked: true })
}))

it.effect("latch persists through lower usage, model changes, metadata updates and concurrent observations", () => Effect.gen(function* () {
  const input = yield* setup
  const results = yield* Effect.all([SessionHealth.observe(input.db, input.id, { inputTokens: 250_000 }), SessionHealth.observe(input.db, input.id, { inputTokens: 300_000 })], { concurrency: "unbounded" })
  expect(results[0].lockedAt).toBe(results[1].lockedAt)
  yield* input.db.update(SessionTable).set({ metadata: sql`json_set(${SessionTable.metadata}, '$.concurrent', 'retained')` }).where(eq(SessionTable.id, input.id)).run().pipe(Effect.orDie)
  expect(yield* SessionHealth.observe(input.db, input.id, { inputTokens: 1, modelContext: 1_000_000 })).toMatchObject({ locked: true, lockedAt: results[0].lockedAt })
  const row = yield* input.db.select().from(SessionTable).where(eq(SessionTable.id, input.id)).get().pipe(Effect.orDie)
  expect(row?.metadata).toMatchObject({ unrelated: "preserve", concurrent: "retained" })
}))

it.effect("exact durable retries survive the latch, conflicting retries fail, queued inputs remain pending", () => Effect.gen(function* () {
  const input = yield* setup
  const sessions = yield* SessionV2.Service
  const events = yield* EventV2.Service
  const prompt = { id: SessionMessage.ID.create(), sessionID: input.id, prompt: { text: "Keep this queued" }, delivery: "queue" as const, resume: false }
  const admitted = yield* sessions.prompt(prompt)
  const steer = yield* sessions.prompt({ sessionID: input.id, prompt: { text: "Keep this steer" }, resume: false })
  yield* SessionHealth.observe(input.db, input.id, { inputTokens: 250_000 })
  expect(yield* sessions.prompt(prompt)).toEqual(admitted)
  expect((yield* sessions.prompt({ ...prompt, prompt: { text: "Conflicting" } }).pipe(Effect.flip))._tag).toBe("Session.PromptConflictError")
  expect((yield* sessions.prompt({ ...prompt, id: SessionMessage.ID.create() }).pipe(Effect.flip))._tag).toBe("Session.ContextLockedError")
  expect(yield* SessionInput.promoteNextQueued(input.db, events, input.id)).toBe(false)
  expect(yield* SessionInput.promoteSteers(input.db, events, input.id, Number.MAX_SAFE_INTEGER)).toBe(0)
  expect((yield* SessionInput.find(input.db, admitted.id))?.promotedSeq).toBeUndefined()
  expect((yield* SessionInput.find(input.db, steer.id))?.promotedSeq).toBeUndefined()
  expect(yield* sessions.messages({ sessionID: input.id })).toEqual([])
}))

it.effect("reconciles a historical projected exact retry after locking", () => Effect.gen(function* () {
  const input = yield* setup
  const sessions = yield* SessionV2.Service
  const id = SessionMessage.ID.create()
  yield* input.db.insert(SessionMessageTable).values({ id, session_id: input.id, seq: 0, type: "user", data: Schema.encodeSync(SessionMessage.User)(SessionMessage.User.make({ id, type: "user", text: "Historical objective", time: { created: DateTime.makeUnsafe(1) } })) }).run().pipe(Effect.orDie)
  yield* SessionHealth.observe(input.db, input.id, { inputTokens: 250_000 })
  expect(yield* sessions.prompt({ sessionID: input.id, id, prompt: { text: "Historical objective" }, resume: false })).toMatchObject({ promotedSeq: 0 })
}))

it.effect("legacy settlement persists the latch before a later small request", () => Effect.gen(function* () {
  const input = yield* setup
  const events = yield* EventV2.Service
  const info = Schema.decodeUnknownSync(SessionV1.Assistant)({ id: MessageID.ascending(), sessionID: input.id, role: "assistant", parentID: MessageID.ascending(), modelID: "test", providerID: "test", mode: "build", agent: "build", path: { cwd: "/project", root: "/project" }, cost: 0, time: { created: 1 }, tokens: { input: 200_000, output: 10, reasoning: 0, cache: { read: 50_000, write: 0 } } })
  yield* events.publish(SessionV1.Event.MessageUpdated, { sessionID: input.id, info })
  yield* input.db.delete(MessageTable).where(eq(MessageTable.session_id, input.id)).run().pipe(Effect.orDie)
  expect((yield* SessionHealth.get(input.db, input.id)).locked).toBe(true)
}))

it.effect("handoff preserves objective, summary, queued work, todos, paths and unknown outcomes without raw output", () => Effect.gen(function* () {
  const input = yield* setup
  const sessions = yield* SessionV2.Service
  const events = yield* EventV2.Service
  const first = yield* sessions.prompt({ sessionID: input.id, prompt: { text: "Implement context locking" }, resume: false })
  yield* SessionInput.promoteSteers(input.db, events, input.id, first.admittedSeq)
  yield* sessions.prompt({ sessionID: input.id, prompt: { text: "Verify the uncertain write" }, delivery: "queue", resume: false })
  yield* input.db.insert(SessionMessageTable).values({ id: SessionMessage.ID.create(), session_id: input.id, seq: 10, type: "compaction", data: Schema.encodeSync(SessionMessage.Compaction)(SessionMessage.Compaction.make({ id: SessionMessage.ID.create(), type: "compaction", reason: "auto", time: { created: DateTime.makeUnsafe(1) }, summary: "Earlier decisions retained", recent: "Tests unfinished" })) }).run().pipe(Effect.orDie)
  yield* input.db.insert(TodoTable).values({ session_id: input.id, position: 0, content: "Check persistence", status: "pending", priority: "high" }).run().pipe(Effect.orDie)
  yield* input.db.insert(TodoTable).values({ session_id: input.id, position: 1, content: "Added safety checks", status: "completed", priority: "high" }).run().pipe(Effect.orDie)
  const messageID = MessageID.ascending()
  yield* input.db.insert(MessageTable).values({ id: messageID, session_id: input.id, data: Schema.decodeUnknownSync(SessionV1.Assistant)({ id: messageID, sessionID: input.id, role: "assistant", parentID: MessageID.ascending(), modelID: "test", providerID: "test", agent: "build", mode: "build", path: { cwd: "/project", root: "/project" }, cost: 0, time: { created: 1 }, tokens: { input: 1, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }) }).run().pipe(Effect.orDie)
  yield* input.db.insert(PartTable).values([
    { id: PartID.ascending(), session_id: input.id, message_id: messageID, data: Schema.decodeUnknownSync(SessionV1.ToolPart)({ id: PartID.ascending(), sessionID: input.id, messageID, type: "tool", tool: "write", callID: "call_write", state: { status: "running", time: { start: 1 }, input: { secret: "private-input" } } }) },
    { id: PartID.ascending(), session_id: input.id, message_id: messageID, data: Schema.decodeUnknownSync(SessionV1.PatchPart)({ id: PartID.ascending(), sessionID: input.id, messageID, type: "patch", hash: "test", files: ["src/context.ts"] }) },
    { id: PartID.ascending(), session_id: input.id, message_id: messageID, data: Schema.decodeUnknownSync(SessionV1.ToolPart)({ id: PartID.ascending(), sessionID: input.id, messageID, type: "tool", tool: "bash", callID: "call_check", state: { status: "completed", time: { start: 1, end: 2 }, input: {}, title: "Check", output: "opaque-output", metadata: { exit: 1 } } }) },
  ]).run().pipe(Effect.orDie)
  yield* input.db.insert(SessionMessageTable).values({
    id: SessionMessage.ID.create(), session_id: input.id, seq: 11, type: "assistant",
    data: Schema.encodeSync(SessionMessage.Assistant)(Schema.decodeUnknownSync(SessionMessage.Assistant)({
      id: SessionMessage.ID.create(), type: "assistant", agent: "build", model: { id: "test", providerID: "test" },
      content: [], time: { created: 1, completed: 2 }, finish: "error",
      error: { type: "unknown", message: "Cancelled before completion" },
    })),
  }).run().pipe(Effect.orDie)
  const handoff = yield* sessions.handoff(input.id)
  expect(handoff.text).toContain("failed or interrupted; Cancelled before completion")
  for (const text of ["Implement context locking", "Verify the uncertain write", "Earlier decisions retained", "Tests unfinished", "Check persistence", "Added safety checks", "exit 1 (FAILED)", "src/context.ts", "running; verify effects", input.id, "/project"]) expect(handoff.text).toContain(text)
  expect(handoff.text).not.toContain("private-input")
  expect(handoff.text).not.toContain("opaque-output")
  expect(SessionHandoff.excerpt("TOKEN=secret\n" + "x".repeat(300), 30)).toContain("omitted")
  expect(SessionHandoff.excerpt("important ".repeat(100), 30)).toContain("characters omitted; see original session")
}))
