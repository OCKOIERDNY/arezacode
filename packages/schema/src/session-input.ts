export * as SessionInput from "./session-input"

import { Schema } from "effect"
import { optional } from "./schema"
import { Prompt } from "./prompt"
import { DateTimeUtcFromMillis, NonNegativeInt } from "./schema"
import { SessionDelivery } from "./session-delivery"
import { SessionID } from "./session-id"
import { SessionMessage } from "./session-message"

export const Delivery = SessionDelivery.Delivery
export type Delivery = SessionDelivery.Delivery

export const Preparation = Schema.Struct({
  command: Schema.String,
  status: Schema.Literals(["pending", "running", "completed", "interrupted", "failed"]),
  text: Schema.String.pipe(optional),
  error: Schema.String.pipe(optional),
}).annotate({ identifier: "SessionInput.Preparation" })
export type Preparation = typeof Preparation.Type

export interface Admitted extends Schema.Schema.Type<typeof Admitted> {}
export const Admitted = Schema.Struct({
  admittedSeq: NonNegativeInt,
  id: SessionMessage.ID,
  sessionID: SessionID,
  prompt: Prompt,
  delivery: Delivery,
  timeCreated: DateTimeUtcFromMillis,
  promotedSeq: NonNegativeInt.pipe(optional),
  preparation: Preparation.pipe(optional),
}).annotate({ identifier: "SessionInput.Admitted" })

export const Task = Schema.Struct({
  sessionID: SessionID,
  parentID: SessionID,
  contextID: Schema.NullOr(Schema.String),
  inputID: SessionMessage.ID,
  status: Schema.Literals(["pending", "running", "completed", "interrupted", "failed"]),
  attempt: NonNegativeInt,
  output: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  resultInputID: Schema.NullOr(SessionMessage.ID),
}).annotate({ identifier: "SessionInput.Task" })
export type Task = typeof Task.Type
