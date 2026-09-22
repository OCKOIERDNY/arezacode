export * as Jev from "./jev"

import { Schema } from "effect"
import { optional } from "./schema"

export const Settings = Schema.Struct({
  enabled: Schema.Boolean,
  skills: Schema.Boolean,
  context: Schema.Boolean,
  findings: Schema.Boolean,
  routing: Schema.Boolean,
})
export type Settings = typeof Settings.Type
export const Status = Schema.Struct({ ...Settings.fields, configured: Schema.Boolean })
export const Update = Settings
export const Model = Schema.Struct({ providerID: Schema.String, modelID: Schema.String, variant: Schema.String.pipe(optional) })
export interface Task extends Schema.Schema.Type<typeof Task> {}
export const Task = Schema.Struct({
  kind: Schema.Literals(["cosmetic", "fix", "feature", "review"]),
  relation: Schema.Literals(["standalone", "followup"]),
}).annotate({ identifier: "Jev.Task" })
export const Prepare = Schema.Struct({
  sessionID: Schema.String,
  promptID: Schema.String.pipe(optional),
  text: Schema.String.check(Schema.isMaxLength(100_000)),
  agent: Schema.String,
  auto: Schema.Boolean,
  images: Schema.Boolean.pipe(Schema.optional),
  models: Schema.Array(Model).check(Schema.isMaxLength(255)),
})
export const Prepared = Schema.Struct({
  status: Schema.Literals(["disabled", "missing-key", "unavailable", "ready"]),
  task: Task.pipe(optional),
  model: Model.pipe(Schema.optional),
  routing: Schema.Literals(["selected", "manual", "disabled", "unavailable", "uncertain"]).pipe(optional),
  skills: Schema.Array(Schema.Struct({ name: Schema.String, content: Schema.String })),
})
