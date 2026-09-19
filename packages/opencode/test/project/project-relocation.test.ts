import { describe, expect } from "bun:test"
import { $ } from "bun"
import { Deferred, Effect, Exit, Fiber, Schema } from "effect"
import { eq, sql } from "drizzle-orm"
import path from "path"
import { Project } from "@/project/project"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectCopy } from "@opencode-ai/core/project/copy"
import { ProjectRelocation } from "@opencode-ai/core/project/relocation"
import { EventV2 } from "@opencode-ai/core/event"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Database } from "@opencode-ai/core/database/database"
import { ProjectDirectoryTable, ProjectTable } from "@opencode-ai/core/project/sql"
import { WorkspaceTable } from "@opencode-ai/core/control-plane/workspace.sql"
import { WorkspaceV2 } from "@opencode-ai/core/workspace"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionMessageTable, SessionTable } from "@opencode-ai/core/session/sql"
import { EventTable } from "@opencode-ai/core/event/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Project.node,
      ProjectV2.node,
      ProjectCopy.node,
      ProjectRelocation.node,
      EventV2.node,
      CrossSpawnSpawner.node,
      FSUtil.node,
      Database.node,
    ]),
  ),
)

describe("Project relocation", () => {
  it.live("recovers history after another checkout prunes the missing directory", () =>
    Effect.gen(function* () {
      const fixture = yield* tracked()
      const copies = yield* ProjectCopy.Service
      const clone = path.join(yield* tmpdirScoped(), "clone")
      yield* Effect.promise(() => $`git clone ${fixture.directory} ${clone}`.quiet())
      yield* fixture.project.fromDirectory(clone)
      const destination = path.join(yield* tmpdirScoped(), "renamed")
      yield* fixture.fs.rename(fixture.directory, destination).pipe(Effect.orDie)
      expect((yield* copies.refresh({ projectID: fixture.id })).removed).toContain(AbsolutePath.make(fixture.directory))
      yield* fixture.project.fromDirectory(destination)
      expect((yield* fixture.db.select().from(SessionTable).get())?.directory).toBe(path.join(destination, "src"))
      expect((yield* fixture.db.select().from(WorkspaceTable).get())?.directory).toBe(destination)
    }),
  )

  it.live("recovers a move when the old path is reused by an empty folder", () =>
    Effect.gen(function* () {
      const fixture = yield* tracked()
      const destination = path.join(yield* tmpdirScoped(), "renamed")
      yield* fixture.fs.rename(fixture.directory, destination).pipe(Effect.orDie)
      yield* fixture.fs.makeDirectory(fixture.directory).pipe(Effect.orDie)
      yield* fixture.project.fromDirectory(destination)
      expect((yield* fixture.db.select().from(SessionTable).get())?.directory).toBe(path.join(destination, "src"))
    }),
  )

  it.live("preserves project settings when core registers a changed remote before legacy opens it", () =>
    Effect.gen(function* () {
      const fixture = yield* tracked()
      yield* fixture.db
        .update(ProjectTable)
        .set({ name: "Saved project", commands: { start: "bun dev" } })
        .where(eq(ProjectTable.id, fixture.id))
        .run()
      yield* Effect.promise(() =>
        $`git remote add origin https://example.invalid/areza/relocation.git`.cwd(fixture.directory).quiet(),
      )
      const resolver = yield* ProjectV2.Service
      const relocation = yield* ProjectRelocation.Service
      const resolved = yield* resolver.resolve(AbsolutePath.make(fixture.directory))
      expect(resolved.id).not.toBe(fixture.id)
      yield* relocation.open({
        projectID: resolved.id,
        previousProjectID: resolved.previous,
        directory: resolved.directory,
        gitDirectory: resolved.gitDirectory!,
        store: resolved.vcs?.store,
      })
      const opened = yield* fixture.project.fromDirectory(fixture.directory)
      expect(opened.project.name).toBe("Saved project")
      expect(opened.project.commands).toEqual({ start: "bun dev" })
      expect((yield* fixture.db.select().from(SessionTable).get())?.project_id).toBe(resolved.id)
    }),
  )

  it.live("rolls back session paths and notifications when workspace persistence fails", () =>
    Effect.gen(function* () {
      const fixture = yield* tracked()
      const events = yield* EventV2.Service
      const received: string[] = []
      yield* events.listen((event) =>
        Effect.sync(() => {
          received.push(event.type)
        }),
      )
      const destination = path.join(yield* tmpdirScoped(), "renamed")
      yield* fixture.fs.rename(fixture.directory, destination).pipe(Effect.orDie)
      yield* fixture.db.run(
        sql`CREATE TRIGGER relocation_failure BEFORE UPDATE ON workspace BEGIN SELECT RAISE(ABORT, 'relocation fixture'); END`,
      )
      expect(Exit.isFailure(yield* fixture.project.fromDirectory(destination).pipe(Effect.exit))).toBe(true)
      expect((yield* fixture.db.select().from(SessionTable).get())?.directory).toBe(path.join(fixture.directory, "src"))
      expect((yield* fixture.db.select().from(WorkspaceTable).get())?.directory).toBe(fixture.directory)
      expect(yield* fixture.db.select().from(EventTable).all()).toEqual([])
      expect(received).toEqual([])
    }),
  )

  it.live("publishes a global directory change after native relocation commits", () =>
    Effect.gen(function* () {
      const fixture = yield* tracked()
      const events = yield* EventV2.Service
      const relocation = yield* ProjectRelocation.Service
      const received: EventV2.Payload[] = []
      yield* events.listen((event) =>
        Effect.sync(() => {
          received.push(event)
        }),
      )
      const destination = path.join(yield* tmpdirScoped(), "renamed")
      yield* fixture.fs.rename(fixture.directory, destination).pipe(Effect.orDie)
      yield* relocation.open({
        projectID: fixture.id,
        directory: AbsolutePath.make(destination),
        gitDirectory: AbsolutePath.make(path.join(destination, ".git")),
      })
      const event = received.find((event) => event.type === "project.directories.updated")
      expect(event?.data).toEqual({ projectID: fixture.id, moved: { from: fixture.directory, to: destination } })
      expect(event?.location).toBeUndefined()
    }),
  )

  it.live("delays a new execution until relocation commits its new placement", () =>
    Effect.gen(function* () {
      const fixture = yield* tracked()
      const held = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const placement = yield* Deferred.make<string>()
      const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, never>({
        drain: () =>
          fixture.db
            .select()
            .from(SessionTable)
            .where(eq(SessionTable.id, fixture.sessionID))
            .get()
            .pipe(
              Effect.orDie,
              Effect.flatMap((session) => Deferred.succeed(placement, session!.directory)),
              Effect.asVoid,
            ),
      })
      const destination = path.join(yield* tmpdirScoped(), "renamed")
      yield* fixture.fs.rename(fixture.directory, destination).pipe(Effect.orDie)
      const opening = yield* fixture.project.fromDirectory(destination).pipe(
        Effect.provideService(SessionExecution.Service, {
          active: coordinator.active,
          resume: coordinator.run,
          wake: coordinator.wake,
          interrupt: coordinator.interrupt,
          withIdle: (ids, effect) =>
            coordinator.withIdle(
              ids,
              Deferred.succeed(held, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.andThen(effect)),
            ),
        }),
        Effect.forkChild,
      )
      yield* Deferred.await(held)
      const wake = yield* coordinator.wake(fixture.sessionID).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      expect(yield* coordinator.active).toEqual(new Set())
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(opening)
      yield* Fiber.join(wake)
      expect(yield* Deferred.await(placement)).toBe(path.join(destination, "src"))
    }),
  )

  it.live("keeps the project identity and primary directory after a repository move", () =>
    Effect.gen(function* () {
      const directory = yield* tmpdirScoped({ git: true })
      const destination = path.join(yield* tmpdirScoped(), "renamed")
      const project = yield* Project.Service
      const fs = yield* FSUtil.Service
      const original = yield* project.fromDirectory(directory)

      yield* fs.rename(directory, destination).pipe(Effect.orDie)
      const moved = yield* project.fromDirectory(destination)

      expect(moved.project.id).toBe(original.project.id)
      expect(moved.project.worktree).toBe(destination)
      expect(moved.project.sandboxes).toEqual([])
      expect((yield* project.get(original.project.id))?.worktree).toBe(destination)
    }),
  )

  it.live("preserves workspace IDs, nested session locations and message history", () =>
    Effect.gen(function* () {
      const fixture = yield* tracked()
      const destination = path.join(yield* tmpdirScoped(), "renamed")
      yield* fixture.fs.rename(fixture.directory, destination).pipe(Effect.orDie)

      yield* fixture.project.fromDirectory(destination)
      yield* fixture.project.fromDirectory(destination)

      const session = yield* fixture.db.select().from(SessionTable).where(eq(SessionTable.id, fixture.sessionID)).get()
      expect(session?.project_id).toBe(fixture.id)
      expect(session?.workspace_id).toBe(fixture.workspaceID)
      expect(session?.directory).toBe(path.join(destination, "src"))
      expect(session?.path).toBe("src")
      expect((yield* fixture.db.select().from(WorkspaceTable).get())?.directory).toBe(destination)
      expect(yield* fixture.db.select().from(SessionMessageTable).all()).toEqual(fixture.messages)
      expect(yield* fixture.db.select().from(EventTable).all()).toHaveLength(1)
      expect((yield* fixture.db.select().from(ProjectDirectoryTable).all()).map((row) => row.directory)).toEqual([
        AbsolutePath.make(destination),
      ])
    }),
  )

  it.live("keeps another clone separate when the original checkout disappears", () =>
    Effect.gen(function* () {
      const fixture = yield* tracked()
      const clone = path.join(yield* tmpdirScoped(), "clone")
      yield* Effect.promise(() => $`git clone ${fixture.directory} ${clone}`.quiet())
      yield* fixture.fs.rename(fixture.directory, path.join(yield* tmpdirScoped(), "elsewhere")).pipe(Effect.orDie)

      const opened = yield* fixture.project.fromDirectory(clone)

      expect(opened.project.id).toBe(fixture.id)
      expect(opened.project.worktree).toBe(fixture.directory)
      expect((yield* fixture.db.select().from(SessionTable).get())?.directory).toBe(path.join(fixture.directory, "src"))
      expect((yield* fixture.db.select().from(WorkspaceTable).get())?.directory).toBe(fixture.directory)
      expect(yield* fixture.db.select().from(EventTable).all()).toEqual([])
    }),
  )

  it.live("does not relocate a copied checkout while its recorded source still exists", () =>
    Effect.gen(function* () {
      const fixture = yield* tracked()
      const copy = path.join(yield* tmpdirScoped(), "copy")
      yield* fixture.fs.copy(fixture.directory, copy).pipe(Effect.orDie)

      const opened = yield* fixture.project.fromDirectory(copy)

      expect(opened.project.id).toBe(fixture.id)
      expect(opened.project.worktree).toBe(fixture.directory)
      expect((yield* fixture.db.select().from(SessionTable).get())?.directory).toBe(path.join(fixture.directory, "src"))
      expect(yield* fixture.db.select().from(EventTable).all()).toEqual([])
    }),
  )

  it.live("preserves the main checkout when a linked worktree moves", () =>
    Effect.gen(function* () {
      const fixture = yield* tracked()
      const parent = yield* tmpdirScoped()
      const worktree = path.join(parent, "worktree")
      const destination = path.join(parent, "renamed-worktree")
      yield* Effect.promise(() => $`git worktree add --detach ${worktree} HEAD`.cwd(fixture.directory).quiet())
      yield* fixture.project.fromDirectory(worktree)
      const sessionID = SessionSchema.ID.make("ses_worktree")
      yield* fixture.db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: fixture.id,
          slug: "worktree",
          directory: worktree,
          title: "worktree",
          version: "test",
        })
        .run()
      yield* Effect.promise(() => $`git worktree move ${worktree} ${destination}`.cwd(fixture.directory).quiet())

      const opened = yield* fixture.project.fromDirectory(destination)

      expect(opened.project.id).toBe(fixture.id)
      expect(opened.project.worktree).toBe(fixture.directory)
      expect(opened.project.sandboxes).toEqual([destination])
      expect(
        (yield* fixture.db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get())?.directory,
      ).toBe(destination)
      expect(
        (yield* fixture.db.select().from(SessionTable).where(eq(SessionTable.id, fixture.sessionID)).get())?.directory,
      ).toBe(path.join(fixture.directory, "src"))
      expect((yield* fixture.db.select().from(WorkspaceTable).get())?.directory).toBe(fixture.directory)
    }),
  )

  it.live("does not rewrite directories that only share a path prefix", () =>
    Effect.gen(function* () {
      const fixture = yield* tracked()
      const sibling = `${fixture.directory}-sibling`
      const sessionID = SessionSchema.ID.make("ses_sibling")
      yield* fixture.db
        .insert(SessionTable)
        .values({
          id: sessionID,
          project_id: fixture.id,
          slug: "sibling",
          directory: sibling,
          title: "sibling",
          version: "test",
        })
        .run()
      const destination = path.join(yield* tmpdirScoped(), "renamed")
      yield* fixture.fs.rename(fixture.directory, destination).pipe(Effect.orDie)

      yield* fixture.project.fromDirectory(destination)

      expect(
        (yield* fixture.db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get())?.directory,
      ).toBe(sibling)
      expect(yield* fixture.db.select().from(EventTable).all()).toHaveLength(1)
    }),
  )

  it.live("retries a failed metadata transaction without duplicating session moves", () =>
    Effect.gen(function* () {
      const fixture = yield* tracked()
      const destination = path.join(yield* tmpdirScoped(), "renamed")
      yield* fixture.fs.rename(fixture.directory, destination).pipe(Effect.orDie)
      yield* fixture.db.run(
        sql`CREATE TRIGGER relocation_failure BEFORE UPDATE ON workspace BEGIN SELECT RAISE(ABORT, 'relocation fixture'); END`,
      )

      expect(Exit.isFailure(yield* fixture.project.fromDirectory(destination).pipe(Effect.exit))).toBe(true)
      expect((yield* fixture.db.select().from(ProjectTable).get())?.worktree).toBe(AbsolutePath.make(fixture.directory))
      expect(
        (yield* Effect.promise(() => Bun.file(path.join(destination, ".git", "opencode-location")).json())).directory,
      ).toBe(fixture.directory)
      yield* fixture.db.run(sql`DROP TRIGGER relocation_failure`)
      yield* fixture.project.fromDirectory(destination)

      expect((yield* fixture.db.select().from(ProjectTable).get())?.worktree).toBe(AbsolutePath.make(destination))
      expect((yield* fixture.db.select().from(WorkspaceTable).get())?.directory).toBe(destination)
      expect(yield* fixture.db.select().from(EventTable).all()).toHaveLength(1)
      expect(yield* fixture.db.select().from(SessionMessageTable).all()).toEqual(fixture.messages)
    }),
  )

  it.live("serializes concurrent reopen requests", () =>
    Effect.gen(function* () {
      const fixture = yield* tracked()
      const destination = path.join(yield* tmpdirScoped(), "renamed")
      yield* fixture.fs.rename(fixture.directory, destination).pipe(Effect.orDie)

      const opened = yield* Effect.all(
        [fixture.project.fromDirectory(destination), fixture.project.fromDirectory(destination)],
        { concurrency: "unbounded" },
      )

      expect(opened.map((item) => item.project.worktree)).toEqual([destination, destination])
      expect(yield* fixture.db.select().from(EventTable).all()).toHaveLength(1)
    }),
  )

  it.live(
    "recovers through the current Location service after a process restart",
    () =>
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped({ git: true })
        const parent = yield* tmpdirScoped()
        const database = path.join(parent, "state.sqlite")
        const destination = path.join(parent, "renamed")
        const fs = yield* FSUtil.Service
        const original = yield* Effect.promise(() => reopen(directory, database))
        yield* fs.rename(directory, destination).pipe(Effect.orDie)

        const moved = yield* Effect.promise(() => reopen(destination, database))
        const restarted = yield* Effect.promise(() => reopen(destination, database))

        expect(moved.project.id).toBe(original.project.id)
        expect(moved.project.worktree).toBe(destination)
        expect(moved.sessions[0].id).toBe(original.sessions[0].id)
        expect(moved.sessions[0].workspace_id).toBe(original.sessions[0].workspace_id)
        expect(moved.sessions[0].directory).toBe(destination)
        expect(moved.workspaces[0].directory).toBe(destination)
        expect(moved.messages).toEqual(original.messages)
        expect(restarted).toEqual(moved)
      }),
    30_000,
  )

  it.live("keeps active sessions at their current location until execution stops", () =>
    Effect.gen(function* () {
      const fixture = yield* tracked()
      const destination = path.join(yield* tmpdirScoped(), "renamed")
      const coordinator = yield* SessionRunCoordinator.make<SessionSchema.ID, never>({ drain: () => Effect.never })
      yield* coordinator.wake(fixture.sessionID)
      yield* fixture.fs.rename(fixture.directory, destination).pipe(Effect.orDie)

      const opened = yield* fixture.project.fromDirectory(destination).pipe(
        Effect.provideService(SessionExecution.Service, {
          withIdle: coordinator.withIdle,
          active: coordinator.active,
          resume: coordinator.run,
          wake: coordinator.wake,
          interrupt: coordinator.interrupt,
        }),
        Effect.exit,
      )

      expect(Exit.isFailure(opened)).toBe(true)
      expect((yield* fixture.db.select().from(SessionTable).get())?.directory).toBe(path.join(fixture.directory, "src"))
      expect(yield* fixture.db.select().from(EventTable).all()).toEqual([])
      yield* coordinator.interrupt(fixture.sessionID)
      yield* fixture.project.fromDirectory(destination)
      expect((yield* fixture.db.select().from(SessionTable).get())?.directory).toBe(path.join(destination, "src"))
    }),
  )

  it.live("does not adopt history from a malformed location record", () =>
    Effect.gen(function* () {
      const fixture = yield* tracked()
      const destination = path.join(yield* tmpdirScoped(), "renamed")
      yield* fixture.fs
        .writeFileString(path.join(fixture.directory, ".git", "opencode-location"), "{broken")
        .pipe(Effect.orDie)
      yield* fixture.fs.rename(fixture.directory, destination).pipe(Effect.orDie)

      yield* fixture.project.fromDirectory(destination)

      expect((yield* fixture.db.select().from(SessionTable).get())?.directory).toBe(path.join(fixture.directory, "src"))
      expect(yield* fixture.db.select().from(EventTable).all()).toEqual([])
      expect(yield* fixture.db.select().from(SessionMessageTable).all()).toEqual(fixture.messages)
    }),
  )
})

function tracked() {
  return Effect.gen(function* () {
    const directory = yield* tmpdirScoped({ git: true })
    const project = yield* Project.Service
    const fs = yield* FSUtil.Service
    const db = (yield* Database.Service).db
    const opened = yield* project.fromDirectory(directory)
    const id = opened.project.id
    const workspaceID = WorkspaceV2.ID.ascending()
    const sessionID = SessionSchema.ID.make("ses_relocation")
    yield* fs.makeDirectory(path.join(directory, "src")).pipe(Effect.orDie)
    yield* db
      .insert(WorkspaceTable)
      .values({
        id: workspaceID,
        project_id: id,
        type: "local",
        name: "saved workspace",
        directory,
      })
      .run()
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: id,
        workspace_id: workspaceID,
        slug: "relocation",
        directory: path.join(directory, "src"),
        path: "src",
        title: "saved session",
        version: "test",
      })
      .run()
    const data = { text: "Keep this history", files: [], agents: [], time: { created: 1 } }
    yield* db
      .insert(SessionMessageTable)
      .values({
        id: SessionMessage.ID.create(),
        session_id: sessionID,
        type: "user",
        seq: 0,
        time_created: 1,
        data,
      })
      .run()
    const messages = yield* db.select().from(SessionMessageTable).all()
    return { directory, project, fs, db, id, workspaceID, sessionID, messages }
  })
}

async function reopen(directory: string, database: string) {
  const script = `
    import { Effect } from "effect"
    import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
    import { LayerNode } from "@opencode-ai/core/effect/layer-node"
    import { Location } from "@opencode-ai/core/location"
    import { AbsolutePath } from "@opencode-ai/core/schema"
    import { Database } from "@opencode-ai/core/database/database"
    import { ProjectTable } from "@opencode-ai/core/project/sql"
    import { ProjectRelocation } from "@opencode-ai/core/project/relocation"
    import { WorkspaceTable } from "@opencode-ai/core/control-plane/workspace.sql"
    import { SessionTable, SessionMessageTable } from "@opencode-ai/core/session/sql"
    import { EventTable } from "@opencode-ai/core/event/sql"
    const node = LayerNode.group([
      Location.node, ProjectRelocation.locationNode, Database.node,
    ])
    const result = await Effect.runPromise(Effect.gen(function* () {
      const location = yield* Location.Service
      const db = (yield* Database.Service).db
      if (!(yield* db.select().from(SessionTable).get())) {
        yield* db.insert(WorkspaceTable).values({
          id: "wrk_restart", project_id: location.project.id, type: "local", directory: location.directory,
        }).run()
        yield* db.insert(SessionTable).values({
          id: "ses_restart", workspace_id: "wrk_restart", project_id: location.project.id,
          directory: location.directory, title: "Preserved across restart", slug: "restart", version: "test",
        }).run()
        yield* db.insert(SessionMessageTable).values({
          id: "msg_restart", session_id: "ses_restart", type: "user", seq: 0,
          data: { text: "Keep this history", time: { created: 1 } },
        }).run()
      }
      return {
        project: yield* db.select().from(ProjectTable).get(),
        sessions: yield* db.select().from(SessionTable).all(),
        workspaces: yield* db.select().from(WorkspaceTable).all(),
        messages: yield* db.select().from(SessionMessageTable).all(),
        events: yield* db.select().from(EventTable).all(),
      }
    }).pipe(Effect.provide(AppNodeBuilder.build(node, [
      [Location.node, Location.boundNode({ directory: AbsolutePath.make(process.env.AREZA_TEST_DIRECTORY) })],
    ])), Effect.scoped))
    console.log(JSON.stringify(result))
  `
  const child = Bun.spawn([process.execPath, "--eval", script], {
    cwd: path.resolve(import.meta.dir, "../.."),
    env: { ...process.env, OPENCODE_DB: database, AREZA_TEST_DIRECTORY: directory },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [output, error, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(`Reopen process failed (${code}): ${error}`)
  return Schema.decodeUnknownSync(
    Schema.fromJsonString(
      Schema.Struct({
        project: Schema.Struct({ id: Schema.String, worktree: Schema.String }),
        sessions: Schema.Array(
          Schema.Struct({ id: Schema.String, workspace_id: Schema.String, directory: Schema.String }),
        ),
        workspaces: Schema.Array(Schema.Struct({ directory: Schema.String })),
        messages: Schema.Array(Schema.Unknown),
        events: Schema.Array(Schema.Unknown),
      }),
    ),
  )(output.trim().split("\n").at(-1))
}
