export * as BashTool from "./bash"

import path from "path"
import { ToolFailure } from "@opencode-ai/llm"
import { Duration, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { Config } from "../config"
import { makeLocationNode } from "../effect/app-node"
import { FSUtil } from "../fs-util"
import { LocationMutation } from "../location-mutation"
import { AppProcess } from "../process"
import { PermissionV2 } from "../permission"
import { PositiveInt } from "../schema"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { AutomaticChecks } from "../automatic-checks"
import { createHash } from "node:crypto"
import { engineEnabled } from "../util/native-command"

export const name = "bash"
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1_000
export const MAX_TIMEOUT_MS = 10 * 60 * 1_000
export const MAX_CAPTURE_BYTES = 1024 * 1024

export const Input = Schema.Struct({
  fallbackReason: Schema.String.check(Schema.isMinLength(20), Schema.isMaxLength(500)).pipe(Schema.optional).annotate({ description: "Explain why existing read/search/patch/project_check tools or maintained repository scripts cannot perform this operation. Required for ad hoc inline scripts or bypassing supported mechanical commands." }),
  command: Schema.String.annotate({ description: "Shell command string to execute" }),
  workdir: Schema.String.pipe(Schema.optional).annotate({
    description: "Working directory. Defaults to the active Location; relative paths resolve from that Location.",
  }),
  timeout: PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_TIMEOUT_MS))
    .pipe(Schema.optional)
    .annotate({
      description: `Timeout in milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS} and may not exceed ${MAX_TIMEOUT_MS}.`,
    }),
})

const StructuredOutput = Schema.Struct({
  exit: Schema.Number.pipe(Schema.optional),
  truncated: Schema.Boolean,
  timeout: Schema.Boolean.pipe(Schema.optional),
  checks: Schema.Array(Schema.Struct({
    name: Schema.String,
    workdir: Schema.String,
    command: Schema.String,
    status: Schema.Literals(["passed", "failed", "skipped", "not-configured", "error", "timed-out"]),
    exit: Schema.Number.pipe(Schema.optional),
    durationMs: Schema.Number,
  })).pipe(Schema.optional),
})

const Output = Schema.Struct({
  ...StructuredOutput.fields,
  output: Schema.String,
  warnings: Schema.Array(Schema.String).pipe(Schema.optional),
})

type Output = typeof Output.Type

const structuredOutput = (output: Output) => ({ truncated: output.truncated, ...(output.exit === undefined ? {} : { exit: output.exit }), ...(output.timeout === undefined ? {} : { timeout: output.timeout }), ...(output.checks ? { checks: output.checks } : {}) })

const defaultShell = () => (process.platform === "win32" ? (process.env.COMSPEC ?? "cmd.exe") : "/bin/sh")

const modelOutput = (output: Output) => {
  const warnings = output.warnings?.length
    ? `\n\nWarnings:\n${output.warnings.map((warning) => `- ${warning}`).join("\n")}`
    : ""
  if (output.timeout) return `${warnings.trimStart()}${warnings ? "\n\n" : ""}Command timed out before completion.`
  return `${warnings.trimStart()}${warnings ? "\n\n" : ""}Command exited with code ${output.exit}.`
}

const isTimeout = (error: AppProcess.AppProcessError) =>
  error.cause instanceof Error && error.cause.message === "Timed out"

/**
 * Minimal V2 core shell boundary. Keep parity debt visible without pulling the
 * legacy shell runtime into core.
 */
// TODO: Port tree-sitter bash / PowerShell parser-based approval reduction.
// TODO: Port BashArity reusable command-prefix approvals.
// TODO: Replace token-based command-argument external-directory advisories with parser-based detection.
// TODO: Restore PowerShell and cmd-specific invocation/path handling on Windows.
// TODO: Add plugin shell.env environment augmentation once V2 plugin hooks exist.
// TODO: Add durable/live progress metadata streaming for long-running commands once V2 tool invocation progress context is wired.
// TODO: Persist background job status and define restart recovery before exposing remote observation.
// TODO: Re-add model-facing background launch only with owner-bound get/wait/cancel tools and completion delivery.
// TODO: Add HTTP background-job observation only after durable status, restart recovery, and authorization are defined.
// TODO: Revisit process-group cleanup and platform coverage with shell-specific tests if current AppProcess semantics do not fully cover it.
// TODO: Revisit binary output handling if stdout/stderr decoding is text-only.
// TODO: Stream full shell output into managed storage while retaining only a bounded in-memory preview.

const shellTokens = (command: string) => command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
const unquote = (value: string) => value.replace(/^(['"])(.*)\1$/, "$2")
const externalCommandDirectories = Effect.fn("BashTool.externalCommandDirectories")(function* (
  fs: FSUtil.Interface,
  command: string,
  cwd: string,
) {
  const directories = new Set<string>()
  for (const token of shellTokens(command)) {
    const value = unquote(token).replace(/[;,|&]+$/, "")
    if (!path.isAbsolute(value)) continue
    const resolved = yield* fs.resolve(value)
    if (FSUtil.contains(cwd, resolved)) continue
    directories.add(yield* fs.resolve(path.dirname(resolved)))
  }
  return [...directories]
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const mutation = yield* LocationMutation.Service
    const fs = yield* FSUtil.Service
    const appProcess = yield* AppProcess.Service
    const config = yield* Config.Service
    const permission = yield* PermissionV2.Service
    const checks = new Map<string, number>()

    yield* tools
      .register({
        project_check: Tool.withPermission(Tool.make({
          description: "Run maintained project workflows without writing shell/Python glue. verify discovers and runs lint, typecheck, tests and build in order in one call, including declared workspaces; stops after failure and reports missing/skipped checks. Reuses package/Composer scripts and installed Vitest, Pest/PHPUnit, Ruff, Mypy and Pytest runners. ci uses a declared ci script, otherwise the verify pipeline. deploy explicitly runs verification then the declared deploy script; never selected by verify or ci. script runs a named existing package/Composer script. scripts previews the detected plan. status/diff/review inspect Git. Commands run once, with bounded time/output and normal permissions; no automatic installs or generated scripts. Run from the owning project/package. This executes repository code with host authority, not a sandbox or a trusted acceptance gate. It does not dispatch remote CI workflows.",
          input: Schema.Struct({ operation: Schema.Literals(["verify", "ci", "deploy", "script", "scripts", "dependencies", "test", "typecheck", "lint", "build", "status", "diff", "review"]), script: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][\w:.-]*$/)).pipe(Schema.optional), workdir: Schema.String.pipe(Schema.optional), files: Schema.Array(Schema.String).check(Schema.isMaxLength(40)).pipe(Schema.optional), timeout: PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_TIMEOUT_MS)).pipe(Schema.optional) }),
          output: Output,
          structured: StructuredOutput,
          toStructuredOutput: ({ output }) => structuredOutput(output),
          toModelOutput: ({ output }) => [{ type: "text", text: output.output }, { type: "text", text: modelOutput(output) }],
          execute: (input, context) => Effect.gen(function* () {
            const source = { type: "tool" as const, messageID: context.assistantMessageID, callID: context.toolCallID }
            const target = yield* mutation.resolve({ path: input.workdir ?? ".", kind: "directory" })
            if (target.externalDirectory) yield* permission.assert({ ...LocationMutation.externalDirectoryPermission(target.externalDirectory), sessionID: context.sessionID, agent: context.agent, source })
            const inspection = ["status", "diff", "review"].includes(input.operation)
            if (input.operation === "script" && !input.script) return yield* new ToolFailure({ message: "Select an existing script by name." })
            if (["verify", "ci", "deploy"].includes(input.operation) && input.files?.length) return yield* new ToolFailure({ message: "Workflow checks run the selected project/package. Use operation test for targeted test files." })
            for (const file of input.files ?? []) {
              if (file.startsWith("-") || !FSUtil.contains(target.canonical, path.resolve(target.canonical, file))) return yield* new ToolFailure({ message: "Check targets must be file paths within the selected package, never command options." })
              if (!FSUtil.contains(target.canonical, yield* fs.resolve(path.resolve(target.canonical, file)))) return yield* new ToolFailure({ message: "Check targets must not follow symlinks outside the selected package." })
            }
            if (!inspection) yield* permission.assert({ action: "read", resources: [path.join(target.resource, "**")], save: ["*"], sessionID: context.sessionID, agent: context.agent, source })
            const discovery = inspection ? undefined : yield* projectChecks(fs, target.canonical, input.operation === "script" ? input.script : undefined)
            if (input.operation === "scripts" || input.operation === "dependencies") return { exit: 0, truncated: false, output: JSON.stringify(input.operation === "scripts" ? { scripts: discovery!.scripts, checks: discovery!.plan } : discovery!.dependencies, null, 2) }
            const workflow = ["verify", "ci", "deploy"].includes(input.operation)
            const configuredCI = discovery?.plan.filter((step) => step.name === "ci" && step.command.length)
            const plan = inspection
              ? [{ name: input.operation, workdir: target.canonical, command: ["git", ...(input.operation === "status" ? ["status", "--short"] : ["diff", "HEAD", "--no-ext-diff", "--no-textconv", ...(input.operation === "review" ? ["--check"] : ["--stat", "--patch"]), "--", ...(input.files ?? [])])] }]
              : input.operation === "ci" && configuredCI?.length ? configuredCI
              : discovery!.plan.filter((step) => workflow ? ["lint", "typecheck", "test", "build", ...(input.operation === "deploy" ? ["deploy"] : [])].includes(step.name) : step.name === (input.operation === "script" ? input.script : input.operation))
            if (!plan.some((step) => step.command.length) || (input.operation === "deploy" && !plan.some((step) => step.name === "deploy" && step.command.length))) return yield* new ToolFailure({ message: `No ${input.operation} workflow is configured. Inspect project_check scripts; register maintained commands in the project's package.json or composer.json.` })
            const commands = plan.map((step) => ({ ...step, command: !workflow && !inspection && step.command.length ? [...step.command, ...(input.files ?? [])] : step.command }))
            const commandTexts = commands.filter((step) => step.command.length).map((step) => JSON.stringify({ cwd: step.workdir, argv: step.command }))
            yield* permission.assert({ action: "bash", resources: commandTexts, save: commandTexts, sessionID: context.sessionID, agent: context.agent, source })
            for (const [file, content] of discovery?.inputs ?? []) {
              if ((yield* fs.readFileString(file)) !== content) return yield* new ToolFailure({ message: "Project configuration changed while authorizing the workflow. Run project_check again to discover the current commands." })
            }
            const state = yield* Effect.promise(() => AutomaticChecks.files(target.canonical).catch(() => undefined))
            const key = state ? createHash("sha256").update(JSON.stringify([context.sessionID, target.canonical, commandTexts, [...discovery?.inputs ?? []], [...state.files].sort()])).digest("hex") : undefined
            if (key && (checks.get(key) ?? 0) >= 2) return yield* new ToolFailure({ message: "This check already failed twice on unchanged inputs. Inspect the existing failure, fix the cause, then run it again." })
            const completed: NonNullable<Output["checks"]>[number][] = []
            const outputs: string[] = []
            let captured = 0
            let truncated = false
            for (const step of commands) {
              const command = step.command.map((arg) => JSON.stringify(arg)).join(" ")
              const base = { name: step.name, workdir: step.workdir, command }
              if (!step.command.length || completed.some((check) => ["failed", "error", "timed-out"].includes(check.status))) {
                completed.push({ ...base, durationMs: 0, status: step.command.length ? "skipped" : "not-configured" })
                continue
              }
              const started = Date.now()
              const result = yield* appProcess.run(ChildProcess.make(step.command[0], step.command.slice(1), { cwd: step.workdir, env: { CI: "true" }, extendEnv: true, stdin: "ignore", detached: process.platform !== "win32", forceKillAfter: Duration.seconds(3) }), { combineOutput: true, timeout: Duration.millis(input.timeout ?? MAX_TIMEOUT_MS), maxOutputBytes: MAX_CAPTURE_BYTES }).pipe(Effect.result)
              const output = result._tag === "Success" ? result.success.output ?? Buffer.alloc(0) : Buffer.from(result.failure.message)
              const remaining = Math.max(0, MAX_CAPTURE_BYTES - captured)
              outputs.push(`${step.name} (${step.workdir})\n${output.subarray(0, remaining).toString("utf8") || "(no output)"}`)
              captured += output.length
              truncated ||= output.length > remaining || (result._tag === "Success" && result.success.outputTruncated === true)
              completed.push({ ...base, durationMs: Date.now() - started, ...(result._tag === "Success" ? { exit: result.success.exitCode, status: result.success.exitCode === 0 ? "passed" as const : "failed" as const } : { status: isTimeout(result.failure) ? "timed-out" as const : "error" as const }) })
            }
            const failure = completed.find((check) => ["failed", "error", "timed-out"].includes(check.status))
            if (key) {
              if (!failure) checks.delete(key)
              if (failure) checks.set(key, (checks.get(key) ?? 0) + 1)
              while (checks.size > 100) checks.delete(checks.keys().next().value!)
            }
            const output = `${completed.map((check) => `${check.status}: ${check.name} (${check.workdir})`).join("\n")}\n\n${outputs.join("\n\n")}${truncated ? "\n[output capture truncated]" : ""}`
            return { exit: failure ? failure.exit || 1 : 0, truncated, checks: completed, ...(failure?.status === "timed-out" ? { timeout: true } : {}), output: input.operation === "review" ? `${output}\nPonytail review: inspect project_check diff, verify reuse of existing owners and shared components, preserve permissions and error paths, and run only checks relevant to the actual change. Reserve full verify for cross-cutting changes, release verification or an explicit requirement. Whitespace success alone is not a completed code review.` : output }
          }).pipe(Effect.mapError((error) => error instanceof ToolFailure ? error : new ToolFailure({ message: "Project operation failed or timed out. Check the package path, configured script, and permissions." }))),
        }), "bash"),
        [name]: Tool.make({
          description: `Execute one shell command string with the host user's filesystem, process, and network authority. The active Location is the default working directory. Relative workdir values resolve from that Location. External workdir values require external_directory approval; best-effort command-argument path warnings are advisory only. Timeout values are milliseconds (default: ${DEFAULT_TIMEOUT_MS}; maximum: ${MAX_TIMEOUT_MS}). Uses the configured shell when set; otherwise uses /bin/sh on POSIX and COMSPEC or cmd.exe on Windows.`,
          input: Input,
          output: Output,
          structured: StructuredOutput,
          toStructuredOutput: ({ output }) => structuredOutput(output),
          toModelOutput: ({ output }) => [
            { type: "text", text: output.output },
            { type: "text", text: modelOutput(output) },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              if (!input.fallbackReason && (yield* Effect.promise(() => engineEnabled("ponytail"))) && /(?:^\s*(?:bun\s+(?:run\s+)?(?:test|typecheck|lint|build)\b|git\s+(?:diff|status)\b)|\b(?:python\d*|bun|node)\s+(?:-c|-e|--eval)\b|<<\s*['"]?(?:PY|PYTHON)\b)/.test(input.command)) return yield* new ToolFailure({ message: "Use project_check or an existing maintained script. For an unsupported operation, provide a specific fallbackReason explaining why native tools cannot do it." })
              const source = {
                type: "tool" as const,
                messageID: context.assistantMessageID,
                callID: context.toolCallID,
              }
              const target = yield* mutation.resolve({ path: input.workdir ?? ".", kind: "directory" })
              const external = target.externalDirectory
              if (external)
                yield* permission.assert({
                  ...LocationMutation.externalDirectoryPermission(external),
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source,
                })
              const warnings = (yield* externalCommandDirectories(fs, input.command, target.canonical)).map(
                (directory) =>
                  `Command argument references external directory ${path.join(directory, "*").replaceAll("\\", "/")}. Bash runs with host-user filesystem, process, and network authority; this scan is advisory only.`,
              )
              yield* permission.assert({
                action: name,
                resources: [input.command],
                save: [input.command],
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })

              if ((yield* fs.stat(target.canonical)).type !== "Directory")
                return yield* Effect.fail(new Error(`Working directory is not a directory: ${target.canonical}`))

              const entries = yield* config.entries()
              const shell =
                Object.assign({}, ...entries.flatMap((entry) => (entry.type === "document" ? [entry.info] : [])))
                  .shell ?? defaultShell()
              const command = ChildProcess.make(input.command, [], {
                cwd: target.canonical,
                shell,
                stdin: "ignore",
                detached: process.platform !== "win32",
                forceKillAfter: Duration.seconds(3),
              })
              const timeout = input.timeout ?? DEFAULT_TIMEOUT_MS
              const result = yield* appProcess
                .run(command, {
                  combineOutput: true,
                  timeout: Duration.millis(timeout),
                  maxOutputBytes: MAX_CAPTURE_BYTES,
                })
                .pipe(
                  Effect.catchTag("AppProcessError", (error) =>
                    isTimeout(error) ? Effect.succeed(undefined) : Effect.fail(error),
                  ),
                )
              if (!result) {
                return {
                  output: `Command exceeded timeout of ${timeout} ms. Retry with a larger timeout if the command is expected to take longer.`,
                  truncated: false,
                  timeout: true,
                  ...(warnings.length ? { warnings } : {}),
                }
              }

              const output = result.output?.toString("utf8") || "(no output)"
              const notice = result.outputTruncated
                ? "[output capture truncated at the in-memory safety limit]"
                : undefined
              return {
                exit: result.exitCode,
                output: notice ? `${output}\n\n${notice}` : output,
                truncated: result.outputTruncated === true,
                ...(warnings.length ? { warnings } : {}),
              }
            }).pipe(Effect.mapError((error) => error instanceof ToolFailure ? error : new ToolFailure({ message: `Unable to execute command: ${input.command}` }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/bash",
  layer,
  deps: [ToolRegistry.node, LocationMutation.node, FSUtil.node, AppProcess.node, Config.node, PermissionV2.node],
})

const projectChecks = Effect.fn("BashTool.projectChecks")(function* (fs: FSUtil.Interface, directory: string, script?: string) {
  const inputs = new Map<string, string>()
  const read = Effect.fn(function* (file: string) {
    if (!(yield* fs.exists(file))) return {}
    if (!FSUtil.contains(directory, yield* fs.resolve(file))) return yield* new ToolFailure({ message: "Project manifests must remain inside the selected project." })
    const text = yield* fs.readFileString(file)
    inputs.set(file, text)
    const value = yield* Schema.decodeUnknownEffect(Schema.UnknownFromJsonString)(text)
    return yield* Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Unknown))(value)
  })
  const root = yield* read(path.join(directory, "package.json"))
  const workspace = Array.isArray(root.workspaces) ? root.workspaces : root.workspaces && typeof root.workspaces === "object" && "packages" in root.workspaces ? root.workspaces.packages : []
  const patterns = Array.isArray(workspace) ? workspace.filter((value): value is string => typeof value === "string") : []
  const directories = new Set([directory])
  for (const pattern of patterns.filter((value) => !value.startsWith("!"))) {
    if (path.isAbsolute(pattern) || pattern.split(/[\\/]/).includes("..")) return yield* new ToolFailure({ message: "Workspace patterns must remain inside the selected project." })
    const matches = yield* fs.glob(`${pattern.replace(/\/$/, "")}/package.json`, { cwd: directory, absolute: true, symlink: false })
    for (const file of matches.sort()) {
      const relative = path.relative(directory, path.dirname(file)).replaceAll(path.sep, "/")
      if (relative.split("/").some((part) => ["node_modules", ".git", "vendor", ".venv"].includes(part)) || patterns.some((excluded) => excluded.startsWith("!") && fs.globMatch(excluded.slice(1), relative))) continue
      const canonical = yield* fs.resolve(path.dirname(file))
      if (!FSUtil.contains(directory, canonical)) return yield* new ToolFailure({ message: "Workspace directories must remain inside the selected project." })
      directories.add(canonical)
      if (directories.size > 128) return yield* new ToolFailure({ message: "Select a smaller workspace scope; at most 128 packages are supported per workflow." })
    }
  }
  const projects = []
  for (const workdir of directories) {
    const javascript = workdir === directory ? root : yield* read(path.join(workdir, "package.json"))
    const composer = yield* read(path.join(workdir, "composer.json"))
    projects.push({ workdir, javascript, composer })
  }
  const names = { lint: ["lint:check", "lint"], typecheck: ["typecheck", "type-check", "check:types", "analyse", "analyze"], test: ["test:ci", "test:run", "test"], build: ["build"], ci: ["ci"], deploy: ["deploy"] }
  const plan: Array<{ name: string; workdir: string; command: string[] }> = []
  const scripts = projects.map((project) => ({ workdir: project.workdir, package: Object.keys(project.javascript.scripts && typeof project.javascript.scripts === "object" ? project.javascript.scripts : {}), composer: Object.keys(project.composer.scripts && typeof project.composer.scripts === "object" ? project.composer.scripts : {}) }))
  for (const [name, aliases] of Object.entries({ ...names, ...(script ? { [script]: [script] } : {}) })) {
    const found: typeof plan = []
    for (const project of projects) {
      for (const [kind, document] of [["package", project.javascript], ["composer", project.composer]] as const) {
        if (kind === "package" && project.workdir !== directory && found.some((step) => step.workdir === directory && step.command[0] === "bun" && step.command[1] === "run")) continue
        const configured = document.scripts && typeof document.scripts === "object" ? document.scripts as Record<string, unknown> : {}
        const selected = aliases.find((alias) => typeof configured[alias] === "string" || (kind === "composer" && Array.isArray(configured[alias])))
        if (selected && !(name === "test" && project.workdir === directory && directories.size > 1 && /do.not.run.tests.from.root/.test(String(configured[selected])))) {
          found.push({ name, workdir: project.workdir, command: kind === "package" ? ["bun", "run", selected] : ["composer", "--no-interaction", "run-script", selected, "--"] })
          continue
        }
        if (kind === "package") {
          const dependencies = { ...project.javascript.dependencies as Record<string, unknown>, ...project.javascript.devDependencies as Record<string, unknown> }
          const vitest = path.join(project.workdir, "node_modules", "vitest", "vitest.mjs")
          if (name === "test" && dependencies.vitest && (yield* fs.exists(vitest))) found.push({ name, workdir: project.workdir, command: ["bun", vitest, "run"] })
          continue
        }
        if (!Object.keys(document).length) continue
        const binaries = name === "test" ? [["pest"], ["phpunit"]] : name === "typecheck" ? [["phpstan", "analyse", "--no-progress"]] : name === "lint" ? [["pint", "--test"]] : []
        for (const [binary, ...args] of binaries) {
          const file = path.join(project.workdir, "vendor", "bin", binary)
          if (!(yield* fs.exists(file))) continue
          found.push({ name, workdir: project.workdir, command: ["php", file, ...args] })
          break
        }
      }
      if ((yield* fs.exists(path.join(project.workdir, "pyproject.toml"))) || (yield* fs.exists(path.join(project.workdir, "pytest.ini")))) {
        const runner = name === "test" ? ["pytest"] : name === "lint" ? ["ruff", "check", "."] : name === "typecheck" ? ["mypy", "."] : []
        if (runner.length) {
          const binary = path.join(project.workdir, ".venv", process.platform === "win32" ? "Scripts" : "bin", `${runner[0]}${process.platform === "win32" ? ".exe" : ""}`)
          if (yield* fs.exists(binary)) found.push({ name, workdir: project.workdir, command: [binary, ...runner.slice(1)] })
        }
      }
    }
    const grouped = new Map<string, typeof plan>()
    for (const step of found) {
      if (step.command[0] !== "bun" || step.command[1] !== "run" || step.workdir === directory) {
        plan.push(step)
        continue
      }
      const entries = grouped.get(step.command[2]) ?? []
      entries.push(step)
      grouped.set(step.command[2], entries)
    }
    for (const [script, steps] of grouped) plan.push({ name, workdir: directory, command: ["bun", "run", ...steps.flatMap((step) => ["--filter", `./${path.relative(directory, step.workdir).replaceAll(path.sep, "/")}`]), script] })
    if (!found.length) plan.push({ name, workdir: directory, command: [] })
  }
  return { plan, scripts, inputs, dependencies: projects.map((project) => ({ workdir: project.workdir, dependencies: project.javascript.dependencies ?? {}, devDependencies: project.javascript.devDependencies ?? {}, require: project.composer.require ?? {}, requireDev: project.composer["require-dev"] ?? {} })) }
})
