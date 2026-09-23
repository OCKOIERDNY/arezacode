export * as SessionHealth from "./health"
export { Info, Handoff } from "@opencode-ai/schema/session-health"

import { and, desc, eq, sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { SessionHealth } from "@opencode-ai/schema/session-health"
import { Catalog } from "../catalog"
import type { Database } from "../database/database"
import { ModelV2 } from "../model"
import { ProviderV2 } from "../provider"
import { SessionSchema } from "./schema"
import { MessageTable, SessionMessageTable, SessionTable } from "./sql"

type DB = Database.Interface["db"]

export class LockedError extends Schema.TaggedErrorClass<LockedError>()("Session.ContextLockedError", {
  sessionID: SessionSchema.ID,
}) {
  override get message() {
    return "Context limit reached. Start a new chat and copy the handoff to continue."
  }
}

export const limit = (context?: number) =>
  Math.min(250_000, context !== undefined && Number.isFinite(context) && context > 0 ? Math.floor(context * 0.8) : 250_000)

export const inclusiveInput = (tokens: { input: number; cache: { read: number; write: number } }) =>
  tokens.input + tokens.cache.read + tokens.cache.write

const decodeLock = Schema.decodeUnknownOption(SessionHealth.Info)
const ModelContext = Schema.Struct({ id: Schema.String, providerID: Schema.String, context: Schema.Number })
const decodeModel = Schema.decodeUnknownOption(ModelContext)

export const recordModel = Effect.fn("SessionHealth.recordModel")(function* (
  db: DB,
  sessionID: SessionSchema.ID,
  model: typeof ModelContext.Type,
) {
  yield* db.update(SessionTable).set({
    metadata: sql`json_set(coalesce(${SessionTable.metadata}, '{}'), '$.contextModel', json(${JSON.stringify(model)}))`,
    time_updated: sql`${SessionTable.time_updated}`,
  }).where(eq(SessionTable.id, sessionID)).run().pipe(Effect.orDie)
})

export const observe = Effect.fn("SessionHealth.observe")(function* (
  db: DB,
  sessionID: SessionSchema.ID,
  input: { inputTokens?: number; modelContext?: number },
) {
  const info: SessionHealth.Info = {
    sessionID,
    ...input,
    limit: limit(input.modelContext),
    locked: input.inputTokens !== undefined && input.inputTokens >= limit(input.modelContext),
  }
  if (info.locked) {
    yield* db.update(SessionTable).set({
      metadata: sql`json_set(coalesce(${SessionTable.metadata}, '{}'), '$.contextLock', json(${JSON.stringify({ ...info, lockedAt: Date.now() })}))`,
      time_updated: sql`${SessionTable.time_updated}`,
    }).where(and(eq(SessionTable.id, sessionID), sql`json_extract(${SessionTable.metadata}, '$.contextLock.locked') is not 1`)).run().pipe(Effect.orDie)
  }
  const row = yield* db.select({ metadata: SessionTable.metadata }).from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
  const locked = Option.getOrUndefined(decodeLock(row?.metadata?.contextLock))
  return locked?.locked ? { ...info, locked: true, lockedAt: locked.lockedAt } : info
})

export const get = Effect.fn("SessionHealth.get")(function* (db: DB, sessionID: SessionSchema.ID, context?: number) {
  const session = yield* db.select({ model: SessionTable.model, metadata: SessionTable.metadata }).from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
  const native = yield* db.select({
    input: sql<number>`coalesce(json_extract(${SessionMessageTable.data}, '$.usage.input'), json_extract(${SessionMessageTable.data}, '$.tokens.input') + json_extract(${SessionMessageTable.data}, '$.tokens.cache.read') + json_extract(${SessionMessageTable.data}, '$.tokens.cache.write'))`,
    model: sql<string>`json_extract(${SessionMessageTable.data}, '$.model.id')`,
    provider: sql<string>`json_extract(${SessionMessageTable.data}, '$.model.providerID')`,
    time: SessionMessageTable.time_created,
  }).from(SessionMessageTable).where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "assistant"), sql`(json_extract(${SessionMessageTable.data}, '$.usage.input') is not null or json_extract(${SessionMessageTable.data}, '$.tokens.input') is not null)`)).orderBy(desc(SessionMessageTable.seq)).limit(1).get().pipe(Effect.orDie)
  const legacy = yield* db.select({
    input: sql<number>`json_extract(${MessageTable.data}, '$.tokens.input') + json_extract(${MessageTable.data}, '$.tokens.cache.read') + json_extract(${MessageTable.data}, '$.tokens.cache.write')`,
    model: sql<string>`json_extract(${MessageTable.data}, '$.modelID')`,
    provider: sql<string>`json_extract(${MessageTable.data}, '$.providerID')`,
    time: MessageTable.time_created,
  }).from(MessageTable).where(and(eq(MessageTable.session_id, sessionID), sql`json_extract(${MessageTable.data}, '$.role') = 'assistant'`, sql`(json_extract(${MessageTable.data}, '$.tokens.input') + json_extract(${MessageTable.data}, '$.tokens.cache.read') + json_extract(${MessageTable.data}, '$.tokens.cache.write')) > 0`)).orderBy(desc(MessageTable.time_created), desc(MessageTable.id)).limit(1).get().pipe(Effect.orDie)
  const latest = native && (!legacy || native.time >= legacy.time) ? native : legacy
  const selected = session?.model ?? (latest ? { id: latest.model, providerID: latest.provider } : undefined)
  const catalog = yield* Effect.serviceOption(Catalog.Service)
  const model = Option.isSome(catalog) && selected
    ? yield* catalog.value.model.get(ProviderV2.ID.make(selected.providerID), ModelV2.ID.make(selected.id))
    : undefined
  const recorded = Option.getOrUndefined(decodeModel(session?.metadata?.contextModel))
  return yield* observe(db, sessionID, {
    inputTokens: latest?.input,
    modelContext: context ?? model?.limit.context ?? (recorded && (!selected || recorded.id === selected.id && recorded.providerID === selected.providerID) ? recorded.context : undefined),
  })
})

export const assertOpen = Effect.fn("SessionHealth.assertOpen")(function* (db: DB, sessionID: SessionSchema.ID, context?: number) {
  if ((yield* get(db, sessionID, context)).locked) return yield* new LockedError({ sessionID })
})
