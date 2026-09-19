export * as ProjectV2 from "./project"
export * as Project from "./project"

import { Context, Effect, Layer, Schema } from "effect"
import path from "path"
import { AbsolutePath } from "./schema"
import { FSUtil } from "./fs-util"
import { Git } from "./git"
import { makeGlobalNode } from "./effect/app-node"
import { Hash } from "./util/hash"
import { ProjectDirectories } from "./project/directories"
import { ProjectSchema } from "./project/schema"
import { Database } from "./database/database"
import { ProjectDirectoryTable, ProjectTable } from "./project/sql"
import { SessionTable } from "./session/sql"
import { WorkspaceTable } from "./control-plane/workspace.sql"
import { eq, sql } from "drizzle-orm"

export const ID = ProjectSchema.ID
export type ID = ProjectSchema.ID

export const Vcs = ProjectSchema.Vcs
export type Vcs = ProjectSchema.Vcs

export class Info extends Schema.Class<Info>("Project.Info")({
  id: ID,
}) {}

export const DirectoriesInput = ProjectDirectories.ListInput
export type DirectoriesInput = typeof DirectoriesInput.Type

export const Directories = ProjectDirectories.ListOutput
export type Directories = typeof Directories.Type

export interface Resolved {
  readonly previous?: ID
  readonly id: ID
  readonly directory: AbsolutePath
  readonly gitDirectory?: AbsolutePath
  readonly vcs?: Vcs
}

export interface Interface {
  readonly directories: (input: DirectoriesInput) => Effect.Effect<Directories>
  readonly resolve: (input: AbsolutePath) => Effect.Effect<Resolved>
  readonly register: (input: Resolved) => Effect.Effect<void>
  readonly commit: (input: { store: AbsolutePath; id: ID }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProjectV2") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const git = yield* Git.Service
    const projectDirectories = yield* ProjectDirectories.Service
    const db = (yield* Database.Service).db

    const directories = Effect.fn("Project.directories")(function* (input: DirectoriesInput) {
      return yield* projectDirectories.list(input.projectID)
    })

    const cached = Effect.fnUntraced(function* (dir: string) {
      return yield* fs.readFileString(path.join(dir, "opencode")).pipe(
        Effect.map((value) => value.trim()),
        Effect.map((value) => (value ? ID.make(value) : undefined)),
        Effect.catch(() => Effect.succeed(undefined)),
      )
    })

    const remote = Effect.fnUntraced(function* (repo: Git.Repository) {
      const origin = yield* git.remote.get(repo)
      if (!origin) return undefined
      const normalized = url(origin)
      if (!normalized) return undefined
      return ID.make(Hash.fast(`git-remote:${normalized}`))
    })

    function url(input: string) {
      const value = input.trim()
      if (!value) return undefined

      try {
        const parsed = new URL(value)
        if (parsed.protocol === "file:") return undefined
        return parts(parsed.hostname, parsed.pathname)
      } catch {
        const scp = value.match(/^([^@/:]+@)?([^/:]+):(.+)$/)
        if (scp) return parts(scp[2], scp[3])
        return undefined
      }
    }

    function parts(host: string, name: string) {
      const pathname = name
        .replace(/^\/+/, "")
        .replace(/\.git\/?$/, "")
        .replace(/\/+$/, "")
      if (!host || !pathname) return undefined
      return `${host.toLowerCase()}/${pathname}`
    }

    const root = Effect.fnUntraced(function* (repo: Git.Repository) {
      const root = (yield* git.history.rootCommits(repo))[0]
      return root ? ID.make(root) : undefined
    })

    const resolve = Effect.fn("Project.resolve")(function* (input: AbsolutePath) {
      const repo = yield* git.repo.discover(input)
      if (!repo) return { id: ID.global, directory: AbsolutePath.make(path.parse(input).root), vcs: undefined }

      const previous = yield* cached(repo.commonDirectory)
      const id = (yield* remote(repo)) ?? previous ?? (yield* root(repo))
      return {
        previous,
        id: id ?? ID.global,
        directory: repo.worktree,
        gitDirectory: repo.gitDirectory,
        vcs: { type: "git" as const, store: repo.commonDirectory },
      }
    })

    const register = Effect.fn("Project.register")(function* (input: Resolved) {
      if (input.id === ID.global) return
      yield* db
        .transaction(
          (tx) =>
            Effect.gen(function* () {
              if (input.previous && input.previous !== ID.global && input.previous !== input.id) {
                const previous = yield* tx.select().from(ProjectTable).where(eq(ProjectTable.id, input.previous)).get()
                if (previous)
                  yield* tx
                    .insert(ProjectTable)
                    .values({ ...previous, id: input.id })
                    .onConflictDoNothing()
                    .run()
                yield* tx
                  .delete(ProjectDirectoryTable)
                  .where(eq(ProjectDirectoryTable.project_id, input.previous))
                  .run()
                yield* tx
                  .update(SessionTable)
                  .set({ project_id: input.id, time_updated: sql`${SessionTable.time_updated}` })
                  .where(eq(SessionTable.project_id, input.previous))
                  .run()
                yield* tx
                  .update(WorkspaceTable)
                  .set({ project_id: input.id })
                  .where(eq(WorkspaceTable.project_id, input.previous))
                  .run()
                if (previous) yield* tx.delete(ProjectTable).where(eq(ProjectTable.id, input.previous)).run()
              }
              yield* tx
                .insert(ProjectTable)
                .values({
                  id: input.id,
                  worktree: input.directory,
                  vcs: "git",
                  sandboxes: [],
                })
                .onConflictDoNothing()
                .run()
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie)
      if (input.vcs) yield* fs.writeFileString(path.join(input.vcs.store, "opencode"), input.id).pipe(Effect.ignore)
    })

    const commit = Effect.fn("Project.commit")(function* (input: { store: AbsolutePath; id: ID }) {
      yield* fs.writeFileString(path.join(input.store, "opencode"), input.id).pipe(Effect.ignore)
    })

    return Service.of({ directories, resolve, register, commit })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer: layer,
  deps: [FSUtil.node, Git.node, ProjectDirectories.node, Database.node],
})
