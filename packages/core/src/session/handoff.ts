export * as SessionHandoff from "./handoff"

import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm"
import { Effect, Schema } from "effect"
import type { Database } from "../database/database"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { MessageTable, PartTable, SessionInputTable, SessionMessageTable, SessionTable, TodoTable } from "./sql"

export const excerpt = (text: string, maximum = 4000) => {
  const safe = text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[credential omitted]")
    .replace(/^.*(?:\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)\b\s*[:=]|^\s*(?:export\s+)?[A-Z][A-Z0-9_]*=).*$/gim, "[credential/environment line omitted]")
    .replace(/\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{16,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, "[credential omitted]")
    .replace(/\b[A-Za-z0-9+/=_-]{160,}\b/g, "[opaque data omitted]")
  return safe.length <= maximum ? safe : `${safe.slice(0, maximum)}\n[${safe.length - maximum} characters omitted; see original session]`
}

export const get = Effect.fn("SessionHandoff.get")(function* (db: Database.Interface["db"], sessionID: SessionSchema.ID) {
  const session = yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get().pipe(Effect.orDie)
  const user = (order: "asc" | "desc") => db.select({
    text: sql<string>`json_extract(${SessionMessageTable.data}, '$.text')`,
    time: SessionMessageTable.time_created,
  }).from(SessionMessageTable).where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "user"))).orderBy(order === "asc" ? asc(SessionMessageTable.seq) : desc(SessionMessageTable.seq)).limit(1).get().pipe(Effect.orDie)
  const legacyUser = Effect.fnUntraced(function* (order: "asc" | "desc", summary = false) {
    const message = yield* db.select({ id: MessageTable.id, time: MessageTable.time_created }).from(MessageTable).where(and(
      eq(MessageTable.session_id, sessionID),
      summary ? sql`json_extract(${MessageTable.data}, '$.summary') = 1` : sql`json_extract(${MessageTable.data}, '$.role') = 'user'`,
    )).orderBy(order === "asc" ? asc(MessageTable.time_created) : desc(MessageTable.time_created), order === "asc" ? asc(MessageTable.id) : desc(MessageTable.id)).limit(1).get().pipe(Effect.orDie)
    if (!message) return
    const parts = yield* db.select({ text: sql<string>`json_extract(${PartTable.data}, '$.text')` }).from(PartTable).where(and(eq(PartTable.message_id, message.id), sql`json_extract(${PartTable.data}, '$.type') = 'text'`, sql`json_extract(${PartTable.data}, '$.synthetic') is not 1`, sql`json_extract(${PartTable.data}, '$.ignored') is not 1`)).orderBy(asc(PartTable.id)).limit(21).all().pipe(Effect.orDie)
    return { time: message.time, text: parts.slice(0, 20).map((part) => excerpt(part.text, 2000)).join("\n\n") + (parts.length > 20 ? "\n[Additional text parts omitted]" : "") }
  })
  const first = [yield* user("asc"), yield* legacyUser("asc")].filter((item) => item !== undefined).sort((a, b) => a.time - b.time)[0]
  const latest = [yield* user("desc"), yield* legacyUser("desc")].filter((item) => item !== undefined).sort((a, b) => b.time - a.time)[0]
  const instructions = yield* db.select({ id: SessionMessageTable.id, text: sql<string>`json_extract(${SessionMessageTable.data}, '$.text')` }).from(SessionMessageTable).where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "user"))).orderBy(desc(SessionMessageTable.seq)).limit(21).all().pipe(Effect.orDie)
  const legacyInstructions = yield* db.select({ id: MessageTable.id, text: sql<string>`json_extract(${PartTable.data}, '$.text')` }).from(MessageTable).innerJoin(PartTable, eq(PartTable.message_id, MessageTable.id)).where(and(eq(MessageTable.session_id, sessionID), sql`json_extract(${MessageTable.data}, '$.role') = 'user'`, sql`json_extract(${PartTable.data}, '$.type') = 'text'`, sql`json_extract(${PartTable.data}, '$.synthetic') is not 1`, sql`json_extract(${PartTable.data}, '$.ignored') is not 1`)).orderBy(desc(MessageTable.time_created), desc(PartTable.id)).limit(21).all().pipe(Effect.orDie)
  const compact = yield* db.select({ text: sql<string>`json_extract(${SessionMessageTable.data}, '$.summary') || char(10) || json_extract(${SessionMessageTable.data}, '$.recent')`, time: SessionMessageTable.time_created }).from(SessionMessageTable).where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "compaction"))).orderBy(desc(SessionMessageTable.seq)).limit(1).get().pipe(Effect.orDie)
  const summary = [compact, yield* legacyUser("desc", true)].filter((item) => item !== undefined).sort((a, b) => b.time - a.time)[0]
  const todos = yield* db.select().from(TodoTable).where(and(eq(TodoTable.session_id, sessionID), ne(TodoTable.status, "completed"), ne(TodoTable.status, "cancelled"))).orderBy(asc(TodoTable.position)).limit(31).all().pipe(Effect.orDie)
  const completed = yield* db.select().from(TodoTable).where(and(eq(TodoTable.session_id, sessionID), eq(TodoTable.status, "completed"))).orderBy(asc(TodoTable.position)).limit(31).all().pipe(Effect.orDie)
  const pending = yield* db.select().from(SessionInputTable).where(and(eq(SessionInputTable.session_id, sessionID), isNull(SessionInputTable.promoted_seq))).orderBy(asc(SessionInputTable.admitted_seq)).limit(21).all().pipe(Effect.orDie)
  const recent = yield* db.select().from(SessionMessageTable).where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "assistant"))).orderBy(desc(SessionMessageTable.seq)).limit(31).all().pipe(Effect.orDie)
  const assistants = recent.slice(0, 30).map((row) => Schema.decodeUnknownSync(SessionMessage.Assistant)({ ...row.data, id: row.id, type: row.type }))
  const legacyAttempts = yield* db.select({
    id: MessageTable.id,
    error: sql<string | null>`coalesce(json_extract(${MessageTable.data}, '$.error.data.message'), json_extract(${MessageTable.data}, '$.error.name'))`,
    finish: sql<string | null>`json_extract(${MessageTable.data}, '$.finish')`,
    completed: sql<number | null>`json_extract(${MessageTable.data}, '$.time.completed')`,
  }).from(MessageTable).where(and(eq(MessageTable.session_id, sessionID), sql`json_extract(${MessageTable.data}, '$.role') = 'assistant'`)).orderBy(desc(MessageTable.time_created), desc(MessageTable.id)).limit(30).all().pipe(Effect.orDie)
  const parts = yield* db.select({
    id: PartTable.id,
    type: sql<string>`json_extract(${PartTable.data}, '$.type')`,
    tool: sql<string>`json_extract(${PartTable.data}, '$.tool')`,
    status: sql<string>`json_extract(${PartTable.data}, '$.state.status')`,
    exit: sql<number | null>`json_extract(${PartTable.data}, '$.state.metadata.exit')`,
    error: sql<string | null>`json_extract(${PartTable.data}, '$.state.error')`,
    files: sql<string | null>`json_extract(${PartTable.data}, '$.files')`,
  }).from(PartTable).where(and(eq(PartTable.session_id, sessionID), sql`json_extract(${PartTable.data}, '$.type') in ('tool', 'patch')`)).orderBy(desc(PartTable.id)).limit(101).all().pipe(Effect.orDie)
  const paths = [...new Set([
    ...assistants.flatMap((message) => message.snapshot?.files ?? []),
    ...parts.slice(0, 100).flatMap((part) => part.type === "patch" && part.files ? Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)))(part.files) : []),
    ...(session?.summary_diffs?.map((diff) => diff.file) ?? []),
  ])]
  const outcomes = [
    ...assistants.flatMap((message) => [
      ...(!message.time.completed ? [`- Provider attempt ${message.id}: incomplete; outcome unknown.`] : []),
      ...(message.error ? [`- Provider attempt ${message.id}: failed or interrupted; ${excerpt(message.error.message, 500)}`] : []),
      ...(message.finish && ["error", "length", "content-filter", "unknown"].includes(message.finish) ? [`- Provider attempt ${message.id}: ${message.finish}; task completion not established.`] : []),
      ...message.content.flatMap((part) => part.type === "tool" && part.state.status !== "completed" ? [`- ${part.name} (${part.id}): ${part.state.status}; verify effects before retrying.${part.state.status === "error" ? ` ${excerpt(part.state.error.message, 500)}` : ""}`] : []),
    ]),
    ...legacyAttempts.flatMap((message) => message.error
      ? [`- Provider attempt ${message.id}: failed or interrupted; ${excerpt(message.error, 500)}`]
      : !message.completed || (message.finish && ["error", "length", "content-filter", "unknown"].includes(message.finish))
        ? [`- Provider attempt ${message.id}: ${message.finish ?? "incomplete"}; task completion not established.`]
        : []),
    ...parts.slice(0, 100).flatMap((part) => part.type === "tool" && part.status !== "completed" ? [`- ${part.tool} (${part.id}): ${part.status ?? "unknown"}; verify effects before retrying.${part.error ? ` ${excerpt(part.error, 500)}` : ""}`] : []),
  ]
  const checks = [
    ...assistants.flatMap((message) => message.content.flatMap((part) => {
      if (part.type !== "tool" || (part.name !== "bash" && part.name !== "project_check")) return []
      const exit = part.state.status === "completed" ? part.state.structured.exit : undefined
      const result = typeof exit === "number" ? `exit ${exit}${exit === 0 ? " (command completed; inspect assertions)" : " (FAILED)"}` : "outcome unknown"
      return [`- ${part.name} (${message.id}/${part.id}): ${result}.`]
    })),
    ...parts.slice(0, 100).flatMap((part) => {
      if (part.type !== "tool" || (part.tool !== "bash" && part.tool !== "project_check")) return []
      const result = part.status === "completed" && part.exit !== null ? `exit ${part.exit}${part.exit === 0 ? " (command completed; inspect assertions)" : " (FAILED)"}` : "outcome unknown"
      return [`- ${part.tool} (${part.id}): ${result}.`]
    }),
  ]
  return { text: [
    "# Session handoff",
    `Original session: ${sessionID}\nProject: ${session?.project_id ?? "unknown"}\nDirectory: ${excerpt(session?.directory ?? "unknown", 500)}\nTitle: ${excerpt(session?.title ?? "unknown", 500)}`,
    "## Objective / first instruction\n" + excerpt(first?.text ?? "No user instruction recorded."),
    "## Latest user instruction\n" + excerpt(latest?.text ?? "No user instruction recorded.", 6000),
    "## Recent instructions / constraints (quoted)\n" + [...instructions.slice(0, 20).toReversed(), ...legacyInstructions.slice(0, 20).toReversed()].map((item) => `### ${item.id}\n${excerpt(item.text, 1000)}`).join("\n\n") + (instructions.length > 20 || legacyInstructions.length > 20 ? "\n[Earlier instructions omitted; consult original session]" : ""),
    "## Prior compaction summary\n" + excerpt(summary?.text ?? "No compaction summary recorded.", 6000),
    "## Recorded completed work\n" + (completed.slice(0, 30).map((todo) => `- ${excerpt(todo.content, 300)}`).join("\n") || "No completed todos recorded.") + (completed.length > 30 ? "\n[Additional completed todos omitted]" : ""),
    "## Pending todos\n" + (todos.slice(0, 30).map((todo) => `- [${todo.status}] ${excerpt(todo.content, 300)}`).join("\n") || "None recorded.") + (todos.length > 30 ? "\n[Additional todos omitted]" : ""),
    "## Pending inputs (not executed)\n" + (pending.slice(0, 20).map((item) => `- ${item.delivery} ${item.id}: ${excerpt(item.prompt.text ?? "[attachment-only prompt]", 500)}${item.prompt.files?.length ? " [Attachments retained in original session]" : ""}`).join("\n") || "None recorded.") + (pending.length > 20 ? "\n[Additional pending inputs omitted]" : ""),
    "## Changed file paths\n" + excerpt(paths.map((file) => `- ${file}`).join("\n") || "No paths recorded in the bounded history window.", 3000),
    "## Incomplete / uncertain work\n" + excerpt(outcomes.join("\n") || "No incomplete outcomes found in the bounded history window. This is not proof all work completed.", 5000),
    "## Verification receipts\n" + excerpt(checks.join("\n") || "No command/check receipts found in the bounded history window. Verification is unknown.", 6000),
    "## Scope and omissions\nGenerated locally from stored records; no model request. Inspect the original session before continuing uncertain work. Raw tool outputs, tool arguments, environment data, credentials, reasoning, and attachment contents are omitted. User instructions and summaries are excerpts, not verified facts. Earlier work outside the latest 30 native assistant messages and 100 legacy tool/patch parts is omitted." + (recent.length > 30 || parts.length > 100 ? " Additional history exists outside this window." : ""),
  ].join("\n\n") }
})
