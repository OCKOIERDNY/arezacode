export * as SessionHealth from "./session-health"

import { Schema } from "effect"
import { NonNegativeInt, optional } from "./schema"
import { SessionID } from "./session-id"

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  sessionID: SessionID,
  inputTokens: NonNegativeInt.pipe(optional),
  limit: NonNegativeInt,
  modelContext: NonNegativeInt.pipe(optional),
  locked: Schema.Boolean,
  lockedAt: NonNegativeInt.pipe(optional),
}).annotate({ identifier: "SessionHealth.Info" })

export interface Handoff extends Schema.Schema.Type<typeof Handoff> {}
export const Handoff = Schema.Struct({ text: Schema.String }).annotate({ identifier: "SessionHealth.Handoff" })
