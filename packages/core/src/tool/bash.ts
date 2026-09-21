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
})

const Output = Schema.Struct({
  ...StructuredOutput.fields,
  output: Schema.String,
  warnings: Schema.Array(Schema.String).pipe(Schema.optional),
})

type Output = typeof Output.Type

const structuredOutput = (output: Output) => ({ truncated: output.truncated, ...(output.exit === undefined ? {} : { exit: output.exit }), ...(output.timeout === undefined ? {} : { timeout: output.timeout }) })

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
          description: "Maintained mechanical project operations. Use scripts/dependencies to inspect package.json, test/typecheck/lint/build to invoke the matching existing package script with Bun, and status/diff/review for fixed Git inspections. No generated shell or Python scripts. Run from the package that owns the change. Repeated failures on unchanged inputs are stopped; fix the inputs before retrying. Review performs Git whitespace checks and supplies the Ponytail review checklist; diff returns the patch to inspect.",
          input: Schema.Struct({ operation: Schema.Literals(["scripts", "dependencies", "test", "typecheck", "lint", "build", "status", "diff", "review"]), workdir: Schema.String.pipe(Schema.optional), files: Schema.Array(Schema.String).check(Schema.isMaxLength(40)).pipe(Schema.optional) }),
          output: Output,
          structured: StructuredOutput,
          toStructuredOutput: ({ output }) => structuredOutput(output),
          toModelOutput: ({ output }) => [{ type: "text", text: output.output }, { type: "text", text: modelOutput(output) }],
          execute: (input, context) => Effect.gen(function* () {
            const source = { type: "tool" as const, messageID: context.assistantMessageID, callID: context.toolCallID }
            const target = yield* mutation.resolve({ path: input.workdir ?? ".", kind: "directory" })
            if (target.externalDirectory) yield* permission.assert({ ...LocationMutation.externalDirectoryPermission(target.externalDirectory), sessionID: context.sessionID, agent: context.agent, source })
            const inspection = ["status", "diff", "review"].includes(input.operation)
            const manifest = path.join(target.canonical, "package.json")
            if (!inspection) yield* permission.assert({ action: "read", resources: [path.join(target.resource, "package.json")], save: ["*"], sessionID: context.sessionID, agent: context.agent, source })
            const document = inspection ? undefined : yield* fs.readFileString(manifest).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.UnknownFromJsonString)))
            const parsed = document && typeof document === "object" ? document as Record<string, unknown> : {}
            const scripts = parsed.scripts && typeof parsed.scripts === "object" ? parsed.scripts as Record<string, unknown> : {}
            if (input.operation === "scripts" || input.operation === "dependencies") return { exit: 0, truncated: false, output: JSON.stringify(input.operation === "scripts" ? Object.keys(scripts).sort() : { dependencies: parsed.dependencies ?? {}, devDependencies: parsed.devDependencies ?? {} }, null, 2) }
            if (!inspection && typeof scripts[input.operation] !== "string") return yield* new ToolFailure({ message: `No ${input.operation} script is configured in ${manifest}. Inspect project_check scripts and use an existing maintained script; unsupported projects may use bash with a specific fallbackReason.` })
            for (const file of input.files ?? []) {
              if (file.startsWith("-") || !FSUtil.contains(target.canonical, path.resolve(target.canonical, file))) return yield* new ToolFailure({ message: "Check targets must be file paths within the selected package, never command options." })
            }
            const executable = inspection ? "git" : "bun"
            const args = input.operation === "status" ? ["status", "--short"] : input.operation === "diff" || input.operation === "review" ? ["diff", "HEAD", "--no-ext-diff", "--no-textconv", ...(input.operation === "review" ? ["--check"] : ["--stat", "--patch"]), "--", ...(input.files ?? [])] : ["run", input.operation, ...(input.files ?? [])]
            const commandText = [executable, ...args].map((arg) => JSON.stringify(arg)).join(" ")
            yield* permission.assert({ action: "bash", resources: [commandText], save: [commandText], sessionID: context.sessionID, agent: context.agent, source })
            const state = yield* Effect.promise(() => AutomaticChecks.files(target.canonical).catch(() => undefined))
            const key = state ? createHash("sha256").update(JSON.stringify([context.sessionID, target.canonical, commandText, [...state.files].sort()])).digest("hex") : undefined
            if (key && (checks.get(key) ?? 0) >= 2) return yield* new ToolFailure({ message: "This check already failed twice on unchanged inputs. Inspect the existing failure, fix the cause, then run it again." })
            const result = yield* appProcess.run(ChildProcess.make(executable, args, { cwd: target.canonical, stdin: "ignore", detached: process.platform !== "win32", forceKillAfter: Duration.seconds(3) }), { combineOutput: true, timeout: Duration.minutes(5), maxOutputBytes: MAX_CAPTURE_BYTES })
            if (key) {
              if (result.exitCode === 0) checks.delete(key)
              if (result.exitCode !== 0) checks.set(key, (checks.get(key) ?? 0) + 1)
              while (checks.size > 100) checks.delete(checks.keys().next().value!)
            }
            const output = result.output?.toString("utf8") || "(no output)"
            return { exit: result.exitCode, truncated: result.outputTruncated === true, output: input.operation === "review" ? `${output}\nPonytail review: inspect project_check diff, verify reuse of existing owners and shared components, remove unnecessary abstractions, preserve permissions and error paths, and run the smallest relevant configured check. Whitespace success alone is not a completed code review.` : output }
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
