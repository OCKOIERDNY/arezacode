import fs from "fs/promises"
import { realpathSync } from "node:fs"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Config } from "@opencode-ai/core/config"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AppProcess } from "@opencode-ai/core/process"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { BashTool } from "@opencode-ai/core/tool/bash"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, settleTool, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_bash_tool_test")
const assertions: PermissionV2.AssertInput[] = []
const runs: Array<{
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly cwd?: string
  readonly shell?: string | boolean
  readonly options?: AppProcess.RunOptions
}> = []
let denyAction: string | undefined
let result: AppProcess.RunResult = {
  command: "mock",
  exitCode: 0,
  output: Buffer.from("hello\n"),
  stdout: Buffer.from("hello\n"),
  stderr: Buffer.alloc(0),
  outputTruncated: false,
  stdoutTruncated: false,
  stderrTruncated: false,
}
let runFailure: AppProcess.AppProcessError | undefined
let afterPermission = (_input: PermissionV2.AssertInput): Effect.Effect<void> => Effect.void

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => assertions.push(input)).pipe(
        Effect.andThen(Effect.suspend(() => afterPermission(input))),
        Effect.andThen(
          input.action === denyAction ? Effect.fail(new PermissionV2.BlockedError({ rules: [] })) : Effect.void,
        ),
      ),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const appProcess = Layer.succeed(
  AppProcess.Service,
  AppProcess.Service.of({
    run: (command: ChildProcess.Command, options?: AppProcess.RunOptions) =>
      Effect.suspend(() => {
        if (command._tag !== "StandardCommand") throw new Error("expected standard command")
        runs.push({ command: command.command, args: command.args, cwd: command.options.cwd, shell: command.options.shell, options })
        return runFailure ? Effect.fail(runFailure) : Effect.succeed(result)
      }),
  } as unknown as AppProcess.Interface),
)
const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () => Effect.succeed([]),
  }),
)

const reset = () => {
  assertions.length = 0
  runs.length = 0
  denyAction = undefined
  runFailure = undefined
  afterPermission = () => Effect.void
  result = {
    command: "mock",
    exitCode: 0,
    output: Buffer.from("hello\n"),
    stdout: Buffer.from("hello\n"),
    stderr: Buffer.alloc(0),
    outputTruncated: false,
    stdoutTruncated: false,
    stderrTruncated: false,
  }
}

const withTool = <A, E, R>(
  directory: string,
  body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>,
  processLayer: Layer.Layer<AppProcess.Service> = appProcess,
) => {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  return Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(
        LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, LocationMutation.node, BashTool.node]),
        [
          [Location.node, activeLocation],
          [PermissionV2.node, permission],
          [AppProcess.node, processLayer],
          [Config.node, config],
          [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
        ],
      ),
    ),
  )
}

const call = (input: typeof BashTool.Input.Type, id = "call-bash") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "bash", input },
})

const it = testEffect(Layer.empty)

describe("BashTool", () => {
  it.live("runs one verification pipeline in order and stops before build or deploy on failure", () => Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => { reset(); return withTool(tmp.path, (registry) => Effect.gen(function* () {
      yield* Effect.promise(async () => {
        await fs.writeFile(path.join(tmp.path, "package.json"), JSON.stringify({ scripts: Object.fromEntries(["lint", "typecheck", "test", "build", "ci", "deploy"].map((name) => [name, `bun run check.ts ${name}`])) }))
        await fs.writeFile(path.join(tmp.path, "check.ts"), 'import { appendFileSync, existsSync } from "node:fs"; const name = process.argv.at(-1)!; appendFileSync("executed", `${name}\\n`); if (name === "test" && existsSync("fail")) process.exit(7)')
      })
      const invoke = (operation: string) => settleTool(registry, { sessionID, ...toolIdentity, call: { type: "tool-call", id: `pipeline-${operation}`, name: "project_check", input: { operation } } })
      const success = yield* invoke("verify")
      expect(success.output?.structured).toMatchObject({ exit: 0, checks: [ { name: "lint", status: "passed" }, { name: "typecheck", status: "passed" }, { name: "test", status: "passed" }, { name: "build", status: "passed" } ] })
      expect(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "executed"), "utf8"))).toBe("lint\ntypecheck\ntest\nbuild\n")
      const ci = yield* invoke("ci")
      expect(ci.output?.structured).toMatchObject({ exit: 0, checks: [{ name: "ci", status: "passed" }] })
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "fail"), ""))
      const failure = yield* invoke("deploy")
      expect(failure.output?.structured).toMatchObject({ exit: 7, checks: [ { status: "passed" }, { status: "passed" }, { status: "failed", exit: 7 }, { status: "skipped" }, { name: "deploy", status: "skipped" } ] })
      expect(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "executed"), "utf8"))).not.toContain("deploy")
      yield* Effect.promise(() => fs.unlink(path.join(tmp.path, "fail")))
      const deployed = yield* invoke("deploy")
      expect(deployed.output?.structured).toMatchObject({ exit: 0 })
      expect(yield* Effect.promise(() => fs.readFile(path.join(tmp.path, "executed"), "utf8"))).toEndWith("lint\ntypecheck\ntest\nbuild\ndeploy\n")
    }), LayerNode.compile(AppProcess.node)) },
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ))
  it.live("discovers workspace scripts and installed PHP and Python checks without executing during discovery", () => Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => { reset(); return withTool(tmp.path, (registry) => Effect.gen(function* () {
      yield* Effect.promise(async () => {
        await fs.mkdir(path.join(tmp.path, "packages", "web"), { recursive: true })
        await fs.writeFile(path.join(tmp.path, "package.json"), JSON.stringify({ workspaces: ["packages/*"], scripts: { test: "echo do-not-run-tests-from-root && exit 1" } }))
        await fs.writeFile(path.join(tmp.path, "packages", "web", "package.json"), JSON.stringify({ name: "web", scripts: { test: "vitest run", typecheck: "tsgo --noEmit" } }))
      })
      const workspace = yield* settleTool(registry, { sessionID, ...toolIdentity, call: { type: "tool-call", id: "workspace-check", name: "project_check", input: { operation: "verify" } } })
      expect(workspace.output?.structured).toMatchObject({ exit: 0, checks: [ { name: "lint", status: "not-configured" }, { name: "typecheck", status: "passed" }, { name: "test", status: "passed" }, { name: "build", status: "not-configured" } ] })
      expect(runs.map((run) => run.args)).toEqual([["run", "--filter", "./packages/web", "typecheck"], ["run", "--filter", "./packages/web", "test"]])
      yield* Effect.promise(async () => {
        await fs.writeFile(path.join(tmp.path, "composer.json"), JSON.stringify({ "require-dev": { "pestphp/pest": "^3" } }))
        await fs.mkdir(path.join(tmp.path, "vendor", "bin"), { recursive: true })
        await fs.writeFile(path.join(tmp.path, "vendor", "bin", "pest"), "<?php")
        await fs.writeFile(path.join(tmp.path, "pyproject.toml"), "[tool.pytest.ini_options]\n")
        const bin = path.join(tmp.path, ".venv", process.platform === "win32" ? "Scripts" : "bin")
        await fs.mkdir(bin, { recursive: true })
        await fs.writeFile(path.join(bin, `pytest${process.platform === "win32" ? ".exe" : ""}`), "")
      })
      const before = runs.length
      const preview = yield* settleTool(registry, { sessionID, ...toolIdentity, call: { type: "tool-call", id: "preview-check", name: "project_check", input: { operation: "scripts" } } })
      expect(preview.result.type).toBe("content")
      expect(JSON.stringify(preview.result)).toContain("pest")
      expect(JSON.stringify(preview.result)).toContain("pytest")
      expect(runs).toHaveLength(before)
    })) },
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ))
  it.live("executes workspace checks through Bun without running a guarded root test script", () => Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => { reset(); return withTool(tmp.path, (registry) => Effect.gen(function* () {
      yield* Effect.promise(async () => {
        await fs.mkdir(path.join(tmp.path, "packages", "web"), { recursive: true })
        await fs.writeFile(path.join(tmp.path, "package.json"), JSON.stringify({ workspaces: ["packages/*"], scripts: { test: "echo do-not-run-tests-from-root && exit 1" } }))
        await fs.writeFile(path.join(tmp.path, "packages", "web", "package.json"), JSON.stringify({ name: "web", scripts: { test: "bun --version" } }))
      })
      const checked = yield* settleTool(registry, { sessionID, ...toolIdentity, call: { type: "tool-call", id: "real-workspace-check", name: "project_check", input: { operation: "verify" } } })
      expect(checked.output?.structured).toMatchObject({ exit: 0, checks: [{ status: "not-configured" }, { status: "not-configured" }, { name: "test", status: "passed" }, { status: "not-configured" }] })
    }), LayerNode.compile(AppProcess.node)) },
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ))
  it.live("reports timed out checks, skips following steps and rejects a stale approved plan", () => Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => { reset(); return withTool(tmp.path, (registry) => Effect.gen(function* () {
      const manifest = path.join(tmp.path, "package.json")
      yield* Effect.promise(() => fs.writeFile(manifest, JSON.stringify({ scripts: { lint: "bun --version", test: "bun test" } })))
      runFailure = new AppProcess.AppProcessError({ command: "bun", cause: new Error("Timed out") })
      const timeout = yield* settleTool(registry, { sessionID, ...toolIdentity, call: { type: "tool-call", id: "timeout-check", name: "project_check", input: { operation: "verify" } } })
      expect(timeout.output?.structured).toMatchObject({ exit: 1, timeout: true, checks: [ { status: "timed-out" }, { status: "not-configured" }, { status: "skipped" }, { status: "not-configured" } ] })
      expect(runs).toHaveLength(1)
      reset()
      afterPermission = (input) => input.action === "bash" ? Effect.promise(() => fs.writeFile(manifest, JSON.stringify({ scripts: { lint: "different-command" } }))) : Effect.void
      const stale = yield* settleTool(registry, { sessionID, ...toolIdentity, call: { type: "tool-call", id: "stale-check", name: "project_check", input: { operation: "verify" } } })
      expect(stale.result.type).toBe("error")
      expect(JSON.stringify(stale.result)).toContain("configuration changed")
      expect(runs).toHaveLength(0)
      reset()
      denyAction = "bash"
      const denied = yield* settleTool(registry, { sessionID, ...toolIdentity, call: { type: "tool-call", id: "denied-check", name: "project_check", input: { operation: "verify" } } })
      expect(denied.result.type).toBe("error")
      expect(runs).toHaveLength(0)
      reset()
      yield* Effect.promise(async () => {
        await fs.mkdir(path.join(tmp.path, "package"))
        await fs.writeFile(path.join(tmp.path, "outside.ts"), "")
        await fs.symlink(path.join(tmp.path, "outside.ts"), path.join(tmp.path, "package", "link.ts"))
      })
      const escaped = yield* settleTool(registry, { sessionID, ...toolIdentity, call: { type: "tool-call", id: "symlink-check", name: "project_check", input: { operation: "test", workdir: "package", files: ["link.ts"] } } })
      expect(escaped.result.type).toBe("error")
      expect(JSON.stringify(escaped.result)).toContain("symlinks")
      expect(runs).toHaveLength(0)
    })) },
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ))
  it.live("uses configured mechanical checks and rejects inline scripts without a fallback explanation", () => Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => { reset(); return withTool(tmp.path, (registry) => Effect.gen(function* () {
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "package.json"), JSON.stringify({ scripts: { typecheck: "bun --version" } })))
      const blocked = yield* settleTool(registry, call({ command: "python -c 'print(1)'" }))
      expect(blocked.result.type).toBe("error")
      expect(runs).toHaveLength(0)
      const checked = yield* settleTool(registry, { sessionID, ...toolIdentity, call: { type: "tool-call", id: "mechanical-check", name: "project_check", input: { operation: "typecheck" } } })
      expect(checked.result.type).toBe("content")
      expect(runs[0]?.command).toBe("bun")
      expect(runs[0]?.shell).toBeUndefined()
      expect(assertions.some((entry) => entry.action === "bash")).toBe(true)
      const unsupported = yield* settleTool(registry, { sessionID, ...toolIdentity, call: { type: "tool-call", id: "mechanical-missing", name: "project_check", input: { operation: "lint" } } })
      expect(unsupported.result.type).toBe("error")
      expect(runs).toHaveLength(1)
    })) },
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ))
  it.live("registers and returns structured successful output from the active Location", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return withTool(tmp.path, (registry) =>
          Effect.gen(function* () {
            const definitions = yield* toolDefinitions(registry)
            expect(definitions.map((tool) => tool.name)).toEqual(["bash", "project_check"])
            expect(definitions.find((tool) => tool.name === "bash")?.inputSchema).not.toHaveProperty("properties.background")
            expect(definitions[0]?.inputSchema).not.toHaveProperty("properties.description")
            expect(definitions[0]?.outputSchema).not.toHaveProperty("properties.output")
            expect(definitions[0]?.outputSchema).not.toHaveProperty("properties.command")
            expect(definitions[0]?.outputSchema).not.toHaveProperty("properties.cwd")
            expect(yield* toolDefinitions(registry, [{ action: "bash", resource: "*", effect: "deny" }])).toEqual([])
            expect(yield* settleTool(registry, call({ command: "pwd" }))).toEqual({
              result: {
                type: "content",
                value: [
                  { type: "text", text: "hello\n" },
                  { type: "text", text: "Command exited with code 0." },
                ],
              },
              output: {
                structured: {
                  exit: 0,
                  truncated: false,
                },
                content: [
                  { type: "text", text: "hello\n" },
                  { type: "text", text: "Command exited with code 0." },
                ],
              },
            })
            expect(runs).toMatchObject([{ command: "pwd", cwd: realpathSync(tmp.path) }])
            expect(runs[0]?.options).toMatchObject({
              combineOutput: true,
              maxOutputBytes: BashTool.MAX_CAPTURE_BYTES,
            })
            expect(assertions).toMatchObject([{ sessionID, action: "bash", resources: ["pwd"], save: ["pwd"] }])
          }),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("resolves a relative workdir from the active Location", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        return Effect.promise(() => fs.mkdir(path.join(tmp.path, "src"))).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) => executeTool(registry, call({ command: "pwd", workdir: "src" }))),
          ),
          Effect.andThen(
            Effect.sync(() => expect(runs).toMatchObject([{ cwd: realpathSync(path.join(tmp.path, "src")) }])),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("rejects a workdir that stops being a directory during approval", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        const workdir = path.join(tmp.path, "src")
        afterPermission = (input) =>
          input.action === "bash"
            ? Effect.promise(async () => {
                await fs.rm(workdir, { recursive: true })
                await fs.writeFile(workdir, "not a directory")
              }).pipe(Effect.orDie)
            : Effect.void
        return Effect.promise(() => fs.mkdir(workdir)).pipe(
          Effect.andThen(
            withTool(tmp.path, (registry) => executeTool(registry, call({ command: "pwd", workdir: "src" }))),
          ),
          Effect.andThen(
            Effect.sync(() => {
              expect(runs).toEqual([])
              expect(assertions.map((input) => input.action)).toEqual(["bash"])
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  if (process.platform !== "win32") {
    it.live("executes a real shell command through AppProcess", () =>
      Effect.acquireUseRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => {
          reset()
          return withTool(
            tmp.path,
            (registry) => settleTool(registry, call({ command: "printf core-bash" })),
            LayerNode.compile(AppProcess.node),
          ).pipe(
            Effect.andThen((settled) =>
              Effect.sync(() => {
                expect(settled.result).toEqual({
                  type: "content",
                  value: [
                    { type: "text", text: "core-bash" },
                    { type: "text", text: "Command exited with code 0." },
                  ],
                })
                expect(settled.output?.structured).toMatchObject({
                  exit: 0,
                })
                expect(settled.output?.structured).not.toHaveProperty("output")
              }),
            ),
          )
        },
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      ),
    )
  }

  it.live("approves an explicit external workdir before bash execution", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) => {
        reset()
        return withTool(active.path, (registry) =>
          executeTool(registry, call({ command: "pwd", workdir: outside.path })),
        ).pipe(
          Effect.andThen(
            Effect.sync(() => {
              expect(assertions.map((item) => item.action)).toEqual(["external_directory", "bash"])
              expect(assertions[0]).toMatchObject({
                resources: [path.join(realpathSync(outside.path), "*").replaceAll("\\", "/")],
              })
              expect(runs).toHaveLength(1)
            }),
          ),
        )
      },
      ([active, outside]) =>
        Effect.promise(() =>
          Promise.all([active[Symbol.asyncDispose](), outside[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )

  it.live("does not execute after external-directory or bash denial", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) =>
        Effect.gen(function* () {
          reset()
          denyAction = "external_directory"
          yield* withTool(active.path, (registry) =>
            executeTool(registry, call({ command: "pwd", workdir: outside.path })),
          )
          expect(assertions.map((item) => item.action)).toEqual(["external_directory"])
          expect(runs).toEqual([])

          reset()
          denyAction = "bash"
          yield* withTool(active.path, (registry) => executeTool(registry, call({ command: "pwd" })))
          expect(assertions.map((item) => item.action)).toEqual(["bash"])
          expect(runs).toEqual([])
        }),
      ([active, outside]) =>
        Effect.promise(() =>
          Promise.all([active[Symbol.asyncDispose](), outside[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )

  it.live("reports external command arguments as advisory warnings without enforcing approval", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => Promise.all([tmpdir(), tmpdir()])),
      ([active, outside]) => {
        reset()
        denyAction = "external_directory"
        const target = path.join(outside.path, "secret.txt")
        return withTool(active.path, (registry) => settleTool(registry, call({ command: `cat ${target}` }))).pipe(
          Effect.andThen((settled) =>
            Effect.sync(() => {
              expect(assertions.map((item) => item.action)).toEqual(["bash"])
              expect(runs).toHaveLength(1)
              expect(settled.output?.structured).toMatchObject({
                truncated: false,
              })
              expect(settled.output?.structured).not.toHaveProperty("warnings")
              expect(settled.output?.content[1]).toMatchObject({
                type: "text",
                text: expect.stringContaining("Warnings:"),
              })
            }),
          ),
        )
      },
      ([active, outside]) =>
        Effect.promise(() =>
          Promise.all([active[Symbol.asyncDispose](), outside[Symbol.asyncDispose]()]).then(() => undefined),
        ),
    ),
  )

  it.live("keeps non-zero exits useful", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        result = { ...result, exitCode: 7, output: Buffer.from("HEAD full output TAIL") }
        return withTool(tmp.path, (registry) => settleTool(registry, call({ command: "false" }, "call-overflow"))).pipe(
          Effect.andThen((settled) =>
            Effect.sync(() => {
              expect(settled.output?.content[1]).toMatchObject({
                type: "text",
                text: expect.stringContaining("Command exited with code 7"),
              })
              expect(settled.output?.structured).toMatchObject({
                exit: 7,
                truncated: false,
              })
              expect(settled.output?.content[0]).toEqual({ type: "text", text: "HEAD full output TAIL" })
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("surfaces bounded process-capture truncation", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        result = { ...result, outputTruncated: true }
        return withTool(tmp.path, (registry) => settleTool(registry, call({ command: "verbose" }))).pipe(
          Effect.andThen((settled) =>
            Effect.sync(() => {
              expect(settled.output?.structured).toMatchObject({ truncated: true })
              expect(settled.output?.content[0]).toMatchObject({
                type: "text",
                text: expect.stringContaining("output capture truncated"),
              })
              expect(settled.output?.structured).not.toHaveProperty("resource")
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("returns a useful timeout settlement", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => {
        reset()
        runFailure = new AppProcess.AppProcessError({ command: "sleep", cause: new Error("Timed out") })
        return withTool(tmp.path, (registry) => settleTool(registry, call({ command: "sleep 60", timeout: 10 }))).pipe(
          Effect.andThen((settled) =>
            Effect.sync(() => {
              expect(settled.output?.content[1]).toMatchObject({
                type: "text",
                text: expect.stringContaining("Command timed out"),
              })
              expect(settled.output?.structured).toMatchObject({
                timeout: true,
                truncated: false,
              })
            }),
          ),
        )
      },
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})

test("keeps locked deferred parity TODOs visible", async () => {
  const source = await fs.readFile(new URL("../src/tool/bash.ts", import.meta.url), "utf8")
  for (const todo of [
    "Port tree-sitter bash / PowerShell parser-based approval reduction.",
    "Port BashArity reusable command-prefix approvals.",
    "Replace token-based command-argument external-directory advisories with parser-based detection.",
    "Restore PowerShell and cmd-specific invocation/path handling on Windows.",
    "Add plugin shell.env environment augmentation once V2 plugin hooks exist.",
    "Add durable/live progress metadata streaming for long-running commands once V2 tool invocation progress context is wired.",
    "Persist background job status and define restart recovery before exposing remote observation.",
    "Revisit process-group cleanup and platform coverage with shell-specific tests if current AppProcess semantics do not fully cover it.",
    "Revisit binary output handling if stdout/stderr decoding is text-only.",
    "Stream full shell output into managed storage while retaining only a bounded in-memory preview.",
  ]) {
    expect(source).toContain(`TODO: ${todo}`)
  }
})
