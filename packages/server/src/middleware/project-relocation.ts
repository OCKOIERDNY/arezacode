import { ProjectRelocation } from "@opencode-ai/core/project/relocation"
import { Cause, Effect } from "effect"
import { ConflictError } from "@opencode-ai/protocol/errors"

export const relocationConflict = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catchCause((cause): Effect.Effect<never, E | ConflictError> => {
      const busy =
        cause.reasons.length > 0 &&
        cause.reasons.every(
          (reason) => Cause.isDieReason(reason) && reason.defect instanceof ProjectRelocation.BusyError,
        )
      if (!busy) return Effect.failCause(cause)
      return Effect.fail(
        new ConflictError({
          message: "Stop the running sessions before reopening this moved project, then try again.",
          resource: "project",
        }),
      )
    }),
  )
