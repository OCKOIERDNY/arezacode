import type { NotFoundError as StorageNotFoundError } from "@/storage/storage"
import type { Session } from "@/session/session"
import { Effect } from "effect"
import { SessionHealth } from "@opencode-ai/core/session/health"
import { ConflictError } from "../errors"
import * as ApiError from "../errors"

export function mapStorageNotFound<A, R>(self: Effect.Effect<A, StorageNotFoundError, R>) {
  return self.pipe(Effect.mapError((error) => ApiError.notFound(error.message)))
}

export const contextLocked = (error: SessionHealth.LockedError) =>
  new ConflictError({ message: error.message, resource: `session:${error.sessionID}:context` })

export function mapBusy<A, R>(self: Effect.Effect<A, Session.BusyError | SessionHealth.LockedError, R>) {
  return self.pipe(
    Effect.catchTag("Session.ContextLockedError", (error) => Effect.fail(contextLocked(error))),
    Effect.catchTag("SessionBusyError", (error) =>
      Effect.fail(
        new ApiError.SessionBusyError({
          sessionID: error.sessionID,
          message: `Session is busy: ${error.sessionID}`,
        }),
      ),
    ),
  )
}
