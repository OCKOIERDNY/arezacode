export * as SessionInput from "./input"

import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm"
import { Cause, DateTime, Effect, Exit, Schema } from "effect"
import { Admitted, Delivery, Preparation, Task } from "@opencode-ai/schema/session-input"
import type { Database } from "../database/database"
import type { EventV2 } from "../event"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { Prompt } from "./prompt"
import { SessionSchema } from "./schema"
import { SessionHealth } from "./health"
import { SessionInputTable, SessionMessageTable, SessionTaskTable } from "./sql"

type DatabaseService = Database.Interface["db"]

export { Admitted, Delivery, Preparation, Task }

const decodePrompt = Schema.decodeUnknownSync(Prompt)
const encodePrompt = Schema.encodeSync(Prompt)

const fromRow = (row: typeof SessionInputTable.$inferSelect): Admitted =>
  Admitted.make({
    admittedSeq: row.admitted_seq,
    id: SessionMessage.ID.make(row.id),
    sessionID: SessionSchema.ID.make(row.session_id),
    prompt: decodePrompt(row.prompt),
    preparation: row.preparation ?? undefined,
    delivery: row.delivery,
    timeCreated: DateTime.makeUnsafe(row.time_created),
    ...(row.promoted_seq === null ? {} : { promotedSeq: row.promoted_seq }),
  })

export const find = Effect.fn("SessionInput.find")(function* (db: DatabaseService, id: SessionMessage.ID) {
  const row = yield* db.select().from(SessionInputTable).where(eq(SessionInputTable.id, id)).get().pipe(Effect.orDie)
  return row === undefined ? undefined : fromRow(row)
})

export class LifecycleConflict extends Schema.TaggedErrorClass<LifecycleConflict>()("SessionInput.LifecycleConflict", {
  id: SessionMessage.ID,
}) {}

export const admit = Effect.fn("SessionInput.admit")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly preparation?: Preparation
  },
) {
  yield* SessionHealth.get(db, input.sessionID)
  return yield* events.transaction(Effect.gen(function* () {
  const existing = yield* find(db, input.id)
  if (existing !== undefined) return existing
  const projected = yield* db.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, input.id)).get().pipe(Effect.orDie)
  if (projected) {
    const message = Schema.decodeUnknownSync(SessionMessage.Message)({ ...projected.data, id: projected.id, type: projected.type })
    if (message.type !== "user" || projected.session_id !== input.sessionID || input.delivery !== (message.independent ? "queue" : "steer") ||
      JSON.stringify(encodePrompt(Prompt.fromUserMessage(message))) !== JSON.stringify(encodePrompt(input.prompt)))
      return yield* Effect.die(new LifecycleConflict({ id: input.id }))
    yield* projectPrompted(db, { ...input, timeCreated: message.time.created, promotedSeq: projected.seq })
    const reconciled = yield* find(db, input.id)
    if (!reconciled) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
    return reconciled
  }
  if (!input.prompt.independent) yield* SessionHealth.assertOpen(db, input.sessionID)
  const timestamp = yield* DateTime.now
  return yield* events
    .publish(SessionEvent.PromptAdmitted, {
      messageID: input.id,
      sessionID: input.sessionID,
      timestamp,
      prompt: input.prompt,
      delivery: input.delivery,
      preparation: input.preparation,
    })
    .pipe(
      Effect.flatMap((event) =>
        event.durable === undefined
          ? Effect.die("Prompt admission event is missing aggregate sequence")
          : Effect.succeed(
              Admitted.make({
                admittedSeq: event.durable.seq,
                id: input.id,
                sessionID: input.sessionID,
                prompt: input.prompt,
                preparation: input.preparation,
                delivery: input.delivery,
                timeCreated: timestamp,
              }),
            ),
      ),
      Effect.catchDefect((defect) =>
        find(db, input.id).pipe(Effect.flatMap((stored) => (stored ? Effect.succeed(stored) : Effect.die(defect)))),
      ),
    )
  })).pipe(Effect.catchTag("SqlError", Effect.die))
})

export const projectAdmitted = Effect.fn("SessionInput.projectAdmitted")(function* (
  db: DatabaseService,
  input: {
    readonly preparation?: Preparation
    readonly admittedSeq: number
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly timeCreated: DateTime.Utc
  },
) {
  const message = yield* db
    .select({ id: SessionMessageTable.id })
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.id, input.id))
    .get()
    .pipe(Effect.orDie)
  if (message !== undefined) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
  const stored = yield* db
    .insert(SessionInputTable)
    .values({
      id: input.id,
      session_id: input.sessionID,
      admitted_seq: input.admittedSeq,
      preparation: input.preparation,
      prompt: encodePrompt(input.prompt),
      delivery: input.delivery,
      time_created: DateTime.toEpochMillis(input.timeCreated),
    })
    .onConflictDoNothing()
    .returning({ id: SessionInputTable.id })
    .get()
    .pipe(Effect.orDie)
  if (!stored) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
})

export const projectPrompted = Effect.fn("SessionInput.projectPrompted")(function* (
  db: DatabaseService,
  input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly timeCreated: DateTime.Utc
    readonly promotedSeq: number
  },
) {
  const updated = yield* db
    .update(SessionInputTable)
    .set({ promoted_seq: input.promotedSeq })
    .where(
      and(
        eq(SessionInputTable.id, input.id),
        eq(SessionInputTable.session_id, input.sessionID),
        isNull(SessionInputTable.promoted_seq),
      ),
    )
    .returning()
    .get()
    .pipe(Effect.orDie)
  if (updated) {
    const stored = fromRow(updated)
    if (!matchesProjection(stored, input)) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
    return
  }

  const stored = yield* find(db, input.id)
  if (stored) {
    if (!matchesProjection(stored, input) || stored.promotedSeq !== input.promotedSeq)
      return yield* Effect.die(new LifecycleConflict({ id: input.id }))
    return
  }

  yield* db
    .insert(SessionInputTable)
    .values({
      id: input.id,
      session_id: input.sessionID,
      prompt: encodePrompt(input.prompt),
      delivery: input.delivery,
      admitted_seq: input.promotedSeq,
      promoted_seq: input.promotedSeq,
      time_created: DateTime.toEpochMillis(input.timeCreated),
    })
    .run()
    .pipe(Effect.orDie)
})

export const hasPending = Effect.fn("SessionInput.hasPending")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  delivery: Delivery,
) {
  const row = yield* db
    .select({ id: SessionInputTable.id })
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        eq(SessionInputTable.delivery, delivery),
      ),
    )
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return row !== undefined
})

export const defaultDelivery = Effect.fn("SessionInput.defaultDelivery")(function* (db: DatabaseService, sessionID: SessionSchema.ID, id: SessionMessage.ID): Effect.fn.Return<Delivery> {
  const existing = yield* find(db, id)
  if (existing) return existing.delivery
  const projected = yield* db.select({ id: SessionMessageTable.id }).from(SessionMessageTable).where(eq(SessionMessageTable.id, id)).get().pipe(Effect.orDie)
  if (projected) return "steer"
  const boundary = yield* db.select({ id: SessionInputTable.id }).from(SessionInputTable)
    .where(and(eq(SessionInputTable.session_id, sessionID), isNull(SessionInputTable.promoted_seq), sql`json_extract(${SessionInputTable.prompt}, '$.independent') = 1`))
    .limit(1).get().pipe(Effect.orDie)
  return boundary ? "queue" : "steer"
})

export const equivalent = (
  input: Admitted,
  expected: {
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
  },
) => input.delivery === expected.delivery && matchesPrompt(input, expected)

const matchesPrompt = (input: Admitted, expected: { readonly sessionID: SessionSchema.ID; readonly prompt: Prompt }) =>
  input.sessionID === expected.sessionID &&
  JSON.stringify(encodePrompt(input.prompt)) === JSON.stringify(encodePrompt(expected.prompt))

const matchesProjection = (
  input: Admitted,
  expected: {
    readonly sessionID: SessionSchema.ID
    readonly prompt: Prompt
    readonly delivery: Delivery
    readonly timeCreated: DateTime.Utc
  },
) =>
  equivalent(input.preparation?.status === "completed" ? { ...input, prompt: { ...input.prompt, text: input.preparation.text ?? input.prompt.text } } : input, expected) &&
  DateTime.toEpochMillis(input.timeCreated) === DateTime.toEpochMillis(expected.timeCreated)

const publish = Effect.fn("SessionInput.publish")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  rows: ReadonlyArray<typeof SessionInputTable.$inferSelect>,
  prepare?: (row: typeof SessionInputTable.$inferSelect) => Effect.Effect<string>,
) {
  if ((yield* SessionHealth.get(db, sessionID)).locked && (!rows.every((row) => decodePrompt(row.prompt).independent) || !(yield* canStartIndependent(db, sessionID)))) return 0
  const prepared = yield* Effect.forEach(rows, (row) => Effect.gen(function* () {
    if (!row.preparation || row.preparation.status === "completed") return row
    const update = (preparation: Preparation) => events.publish(SessionEvent.CommandPrepared, {
      sessionID, messageID: row.id, timestamp: DateTime.makeUnsafe(Date.now()), preparation,
    }).pipe(Effect.asVoid)
    if (row.preparation.status !== "pending") {
      if (row.preparation.status === "running") yield* update({ ...row.preparation, status: "interrupted", error: "Process stopped during command preparation. Explicit retry required." })
      return yield* Effect.die(new Error("Command preparation was interrupted or failed. Explicit retry required."))
    }
    if (!prepare) return yield* Effect.die(new Error("Command preparation is unavailable"))
    const result = yield* Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
      yield* update({ ...row.preparation!, status: "running" })
      const result = yield* restore(prepare(row)).pipe(Effect.exit)
      if (Exit.isFailure(result)) {
        yield* update({ ...row.preparation!, status: Cause.hasInterruptsOnly(result.cause) ? "interrupted" : "failed", error: String(Cause.squash(result.cause)) })
        return yield* Effect.failCause(result.cause)
      }
      const preparation: Preparation = { ...row.preparation!, status: "completed", text: result.value }
      yield* update(preparation)
      return preparation
    }))
    return { ...row, preparation: result }
  }))
  return yield* events.transaction(Effect.gen(function* () {
  if ((yield* SessionHealth.get(db, sessionID)).locked && (!rows.every((row) => decodePrompt(row.prompt).independent) || !(yield* canStartIndependent(db, sessionID)))) return 0
  for (const row of prepared) {
    const id = SessionMessage.ID.make(row.id)
    yield* events
      .publish(SessionEvent.Prompted, {
        sessionID,
        timestamp: DateTime.makeUnsafe(row.time_created),
        messageID: id,
        prompt: decodePrompt(row.preparation?.status === "completed" ? { ...row.prompt, text: row.preparation.text ?? row.prompt.text } : row.prompt),
        delivery: row.delivery,
      })
      .pipe(
        Effect.catchDefect((defect) =>
          defect instanceof LifecycleConflict
            ? find(db, id).pipe(
                Effect.flatMap((stored) => (stored?.promotedSeq === undefined ? Effect.die(defect) : Effect.void)),
              )
            : Effect.die(defect),
        ),
      )
  }
  return rows.length
  })).pipe(Effect.orDie)
})

export const promoteSteers = Effect.fn("SessionInput.promoteSteers")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  cutoff: number,
  prepare?: (row: typeof SessionInputTable.$inferSelect) => Effect.Effect<string>,
) {
  if ((yield* SessionHealth.get(db, sessionID)).locked) return 0
  const rows = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        eq(SessionInputTable.delivery, "steer"),
        lte(SessionInputTable.admitted_seq, cutoff),
      ),
    )
    .orderBy(asc(SessionInputTable.admitted_seq))
    .all()
    .pipe(Effect.orDie)
  return yield* publish(db, events, sessionID, rows, prepare)
})

export const promoteNextQueued = Effect.fn("SessionInput.promoteNextQueued")(function* (
  db: DatabaseService,
  events: EventV2.Interface,
  sessionID: SessionSchema.ID,
  prepare?: (row: typeof SessionInputTable.$inferSelect) => Effect.Effect<string>,
) {
  const row = yield* db
    .select()
    .from(SessionInputTable)
    .where(
      and(
        eq(SessionInputTable.session_id, sessionID),
        isNull(SessionInputTable.promoted_seq),
        eq(SessionInputTable.delivery, "queue"),
      ),
    )
    .orderBy(asc(SessionInputTable.admitted_seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return row === undefined ? false : (yield* publish(db, events, sessionID, [row], prepare)) > 0
})

export const canStartIndependent = Effect.fn("SessionInput.canStartIndependent")(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  const row = yield* db.select().from(SessionInputTable)
    .where(and(eq(SessionInputTable.session_id, sessionID), isNull(SessionInputTable.promoted_seq), eq(SessionInputTable.delivery, "queue")))
    .orderBy(asc(SessionInputTable.admitted_seq)).limit(1).get().pipe(Effect.orDie)
  if (!row || !decodePrompt(row.prompt).independent) return false
  const earlier = yield* db.select({ id: SessionInputTable.id }).from(SessionInputTable)
    .where(and(eq(SessionInputTable.session_id, sessionID), isNull(SessionInputTable.promoted_seq), eq(SessionInputTable.delivery, "steer"), lte(SessionInputTable.admitted_seq, row.admitted_seq)))
    .limit(1).get().pipe(Effect.orDie)
  return earlier === undefined
})

export const recoverTasks = Effect.fn("SessionInput.recoverTasks")(function* (db: DatabaseService) {
  const tasks = yield* db.select().from(SessionTaskTable).where(eq(SessionTaskTable.status, "running")).all().pipe(Effect.orDie)
  for (const task of tasks) {
    const alive = task.owner && /^\d+$/.test(task.owner) && (yield* Effect.try({ try: () => { process.kill(Number(task.owner), 0); return true }, catch: (error) => error }).pipe(Effect.catch((error) => Effect.succeed(!(error instanceof Error && "code" in error && error.code === "ESRCH")))))
    if (alive) continue
    yield* db.update(SessionTaskTable).set({ status: "interrupted", error: "Process stopped. Explicit retry required.", owner: null, time_updated: Date.now(), time_completed: Date.now() })
      .where(and(eq(SessionTaskTable.session_id, task.session_id), eq(SessionTaskTable.status, "running"), task.owner ? eq(SessionTaskTable.owner, task.owner) : isNull(SessionTaskTable.owner))).run().pipe(Effect.orDie)
  }
})

export const deliverTasks = Effect.fn("SessionInput.deliverTasks")(function* (db: DatabaseService, events: EventV2.Interface, sessionID: SessionSchema.ID) {
  return yield* events.transaction(Effect.gen(function* () {
    const tasks = yield* db.select().from(SessionTaskTable).where(and(eq(SessionTaskTable.parent_id, sessionID), isNull(SessionTaskTable.result_input_id), sql`${SessionTaskTable.status} IN ('completed', 'failed', 'interrupted')`)).all().pipe(Effect.orDie)
    const context = yield* SessionHealth.taskID(db, sessionID)
    if ((yield* SessionHealth.get(db, sessionID)).locked) return
    const boundary = yield* db.select({ id: SessionInputTable.id }).from(SessionInputTable).where(and(eq(SessionInputTable.session_id, sessionID), isNull(SessionInputTable.promoted_seq), sql`json_extract(${SessionInputTable.prompt}, '$.independent') = 1`)).limit(1).get().pipe(Effect.orDie)
    if (boundary) return
    for (const task of tasks) {
      if (task.context_id !== context) continue
      const input = yield* find(db, task.input_id)
      if (!input || input.promotedSeq === undefined) continue
      const id = SessionMessage.ID.create()
      yield* admit(db, events, { id, sessionID, delivery: "steer", prompt: Prompt.make({ text: `Subtask ${task.session_id} ${task.status}:\n${task.output ?? task.error ?? "No output"}` }) })
      yield* db.update(SessionTaskTable).set({ result_input_id: id, time_updated: Date.now() }).where(eq(SessionTaskTable.session_id, task.session_id)).run().pipe(Effect.orDie)
    }
  })).pipe(Effect.orDie)
})

export const contextID = Effect.fn("SessionInput.contextID")(function* (db: DatabaseService, input: Admitted) {
  const boundary = yield* db.select({ id: SessionInputTable.id }).from(SessionInputTable).where(and(eq(SessionInputTable.session_id, input.sessionID), lte(SessionInputTable.admitted_seq, input.admittedSeq), sql`json_extract(${SessionInputTable.prompt}, '$.independent') = 1`)).orderBy(desc(SessionInputTable.admitted_seq)).limit(1).get().pipe(Effect.orDie)
  return boundary?.id ?? (yield* SessionHealth.taskID(db, input.sessionID))
})
