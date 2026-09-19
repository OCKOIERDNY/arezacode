export * as ProjectDirectories from "./project-directories"

import { define, inventory } from "./event"
import { Project } from "./project"
import { Schema } from "effect"
import { AbsolutePath, optional } from "./schema"

const Updated = define({
  type: "project.directories.updated",
  schema: {
    projectID: Project.ID,
    moved: optional(Schema.Struct({ from: AbsolutePath, to: AbsolutePath })),
  },
})
export const Event = { Updated, Definitions: inventory(Updated) }
