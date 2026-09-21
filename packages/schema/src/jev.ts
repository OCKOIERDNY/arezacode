export * as Jev from "./jev"

import { Schema } from "effect"

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
export const Model = Schema.Struct({ providerID: Schema.String, modelID: Schema.String })
export const Prepare = Schema.Struct({
  sessionID: Schema.String,
  text: Schema.String.check(Schema.isMaxLength(100_000)),
  agent: Schema.String,
  auto: Schema.Boolean,
  images: Schema.Boolean.pipe(Schema.optional),
  models: Schema.Array(Model).check(Schema.isMaxLength(255)),
})
export const Prepared = Schema.Struct({
  status: Schema.Literals(["disabled", "missing-key", "unavailable", "ready"]),
  model: Model.pipe(Schema.optional),
  skills: Schema.Array(Schema.Struct({ name: Schema.String, content: Schema.String })),
})
