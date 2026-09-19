export * as ProjectRelocation from "./relocation"

import path from "path"
import { and, eq } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { Database } from "../database/database"
import { makeGlobalNode, makeLocationNode } from "../effect/app-node"
import { KeyedMutex } from "../effect/keyed-mutex"
import { EventV2 } from "../event"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { AbsolutePath, RelativePath } from "../schema"
import { SessionEvent } from "../session/event"
import { SessionExecution } from "../session/execution"
import { SessionProjector } from "../session/projector"
import { SessionTable } from "../session/sql"
import { WorkspaceTable } from "../control-plane/workspace.sql"
import { ProjectSchema } from "./schema"
import { Project } from "../project"
import { ProjectDirectories } from "@opencode-ai/schema/project-directories"
import { ProjectDirectoryTable, ProjectTable } from "./sql"

const Cache = Schema.Struct({ version: Schema.Literal(1), projectID: ProjectSchema.ID, directory: AbsolutePath })
const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Cache))

export interface Input {
  readonly projectID: ProjectSchema.ID
  readonly previousProjectID?: ProjectSchema.ID
  readonly directory: AbsolutePath
  readonly gitDirectory: AbsolutePath
  readonly store?: AbsolutePath
}

export class BusyError extends Schema.TaggedErrorClass<BusyError>()("ProjectRelocation.BusyError", {
  directory: AbsolutePath,
}) {}

export interface Interface {
  readonly open: (input: Input) => Effect.Effect<void, BusyError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProjectRelocation") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const db = (yield* Database.Service).db
    const events = yield* EventV2.Service
    const projects = yield* Project.Service
    const locks = yield* KeyedMutex.make<ProjectSchema.ID>()

    const open = Effect.fn("ProjectRelocation.open")(
      function* (input: Input) {
        if (input.projectID === ProjectSchema.ID.global) return
        yield* projects.register({
          id: input.projectID,
          previous: input.previousProjectID,
          directory: input.directory,
          vcs: input.store ? { type: "git", store: input.store } : undefined,
        })
        const file = path.join(input.gitDirectory, "opencode-location")
        const cached = yield* fs.readFileString(file).pipe(
          Effect.map((value) => Option.getOrUndefined(decode(value))),
          Effect.catch(() => Effect.succeed(undefined)),
        )
        const previous =
          (cached?.projectID === input.projectID || cached?.projectID === input.previousProjectID) &&
          cached &&
          cached.directory !== input.directory &&
          !(yield* projects
            .resolve(cached.directory)
            .pipe(Effect.map((value) => value.id === input.projectID && value.directory === cached.directory)))
            ? cached.directory
            : undefined
        const registerDirectory = db
          .insert(ProjectDirectoryTable)
          .values({ project_id: input.projectID, directory: input.directory })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)
        if (previous) {
          const sessions = yield* db
            .select()
            .from(SessionTable)
            .where(eq(SessionTable.project_id, input.projectID))
            .all()
            .pipe(Effect.orDie)
          const moved = sessions.flatMap((session) => {
            const directory = relocated(session.directory, previous, input.directory)
            return directory ? [{ session, directory }] : []
          })
          const relocate = events
            .transaction(
              Effect.gen(function* () {
                yield* Effect.forEach(
                  moved,
                  (item) =>
                    events.publish(SessionEvent.Moved, {
                      sessionID: item.session.id,
                      location: { directory: item.directory, workspaceID: item.session.workspace_id ?? undefined },
                      subdirectory: RelativePath.make(
                        path.relative(input.directory, item.directory).replaceAll("\\", "/"),
                      ),
                      timestamp: DateTime.makeUnsafe(Date.now()),
                    }),
                  { discard: true },
                )

                yield* db
                  .transaction(
                    (tx) =>
                      Effect.gen(function* () {
                        const project = yield* tx
                          .select()
                          .from(ProjectTable)
                          .where(eq(ProjectTable.id, input.projectID))
                          .get()
                        if (project) {
                          const worktree = relocated(project.worktree, previous, input.directory) ?? project.worktree
                          yield* tx
                            .update(ProjectTable)
                            .set({
                              worktree,
                              sandboxes: project.sandboxes
                                .map((value) => relocated(value, previous, input.directory) ?? value)
                                .filter(
                                  (value, index, values) => value !== worktree && values.indexOf(value) === index,
                                ),
                            })
                            .where(eq(ProjectTable.id, input.projectID))
                            .run()
                        }
                        const directories = yield* tx
                          .select()
                          .from(ProjectDirectoryTable)
                          .where(eq(ProjectDirectoryTable.project_id, input.projectID))
                          .all()
                        yield* Effect.forEach(
                          directories,
                          (row) =>
                            Effect.gen(function* () {
                              const directory = relocated(row.directory, previous, input.directory)
                              if (!directory) return
                              yield* tx
                                .insert(ProjectDirectoryTable)
                                .values({ ...row, directory })
                                .onConflictDoUpdate({
                                  target: [ProjectDirectoryTable.project_id, ProjectDirectoryTable.directory],
                                  set: { strategy: row.strategy, type: row.type, time_created: row.time_created },
                                })
                                .run()
                              yield* tx
                                .delete(ProjectDirectoryTable)
                                .where(
                                  and(
                                    eq(ProjectDirectoryTable.project_id, input.projectID),
                                    eq(ProjectDirectoryTable.directory, row.directory),
                                  ),
                                )
                                .run()
                            }),
                          { discard: true },
                        )
                        const workspaces = yield* tx
                          .select()
                          .from(WorkspaceTable)
                          .where(eq(WorkspaceTable.project_id, input.projectID))
                          .all()
                        yield* Effect.forEach(
                          workspaces,
                          (workspace) =>
                            Effect.gen(function* () {
                              const directory = relocated(workspace.directory, previous, input.directory)
                              if (!directory) return
                              yield* tx
                                .update(WorkspaceTable)
                                .set({ directory })
                                .where(eq(WorkspaceTable.id, workspace.id))
                                .run()
                            }),
                          { discard: true },
                        )
                      }),
                    { behavior: "immediate" },
                  )
                  .pipe(Effect.orDie)
                yield* registerDirectory
                yield* events.publish(
                  ProjectDirectories.Event.Updated,
                  {
                    projectID: input.projectID,
                    moved: { from: previous, to: input.directory },
                  },
                  { location: null },
                )
              }),
            )
            .pipe(Effect.orDie)
          const execution = yield* Effect.serviceOption(SessionExecution.Service)
          const changed = yield* Option.isSome(execution)
            ? execution.value.withIdle(
                moved.map((item) => item.session.id),
                relocate,
              )
            : relocate.pipe(Effect.as(true))
          if (!changed) yield* new BusyError({ directory: previous })
        }

        if (!previous) yield* registerDirectory
        if (cached?.projectID === input.projectID && cached.directory === input.directory) return
        const temporary = `${file}.${crypto.randomUUID()}.tmp`
        yield* fs
          .writeFileString(
            temporary,
            JSON.stringify({
              version: 1,
              projectID: input.projectID,
              directory: input.directory,
            }),
            { mode: 0o600, flag: "wx" },
          )
          .pipe(
            Effect.andThen(fs.rename(temporary, file)),
            Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)),
            Effect.catch((cause) => Effect.logWarning("project location cache write failed", { cause })),
          )
      },
      (effect, input) => locks.withLock(input.projectID)(effect),
    )

    return Service.of({ open })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Database.node, EventV2.node, SessionProjector.node, Project.node],
})

export const locationNode = makeLocationNode({
  name: "project-relocation",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const location = yield* Location.Service
      const relocation = yield* Service
      if (!location.gitDirectory) return
      yield* relocation
        .open({
          projectID: location.project.id,
          previousProjectID: location.previousProjectID,
          directory: location.project.directory,
          gitDirectory: location.gitDirectory,
          store: location.vcs?.store,
        })
        .pipe(Effect.orDie)
    }),
  ),
  deps: [Location.node, node],
})

function relocated(value: string | null, previous: AbsolutePath, directory: AbsolutePath) {
  if (!value) return undefined
  const relative = path.relative(previous, value)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined
  return AbsolutePath.make(path.join(directory, relative))
}
