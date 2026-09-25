export * as InstructionContext from "./instruction-context"

import { Array, Effect, FileSystem, Layer, Schema } from "effect"
import { basename, dirname, isAbsolute, join, relative, sep } from "path"
import { HttpClient, HttpIncomingMessage } from "effect/unstable/http"
import { Config } from "./config"
import { LayerNodePlatform } from "./effect/app-node-platform"
import { FSUtil } from "./fs-util"
import { Flag } from "./flag/flag"
import { Global } from "./global"
import { Location } from "./location"
import { AbsolutePath } from "./schema"
import { SystemContext } from "./system-context/index"
import { SystemContextRegistry } from "./system-context/registry"
import { makeLocationNode } from "./effect/app-node"

class File extends Schema.Class<File>("InstructionContext.File")({
  path: Schema.String,
  content: Schema.String,
}) {}

const Files = Schema.Array(File)
const key = SystemContext.Key.make("core/instructions")

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const registry = yield* SystemContextRegistry.Service
    const config = yield* Config.Service
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)

    const source = (value: ReadonlyArray<File> | SystemContext.Unavailable) =>
      SystemContext.make({
        key,
        codec: Schema.toCodecJson(Files),
        load: Effect.succeed(value),
        baseline: render,
        update: (_previous, current) =>
          `These instructions replace all previously loaded ambient instructions.\n\n${render(current)}`,
        removed: () => "Previously loaded instructions no longer apply.",
      })

    const observe = Effect.fn("InstructionContext.observe")(function* () {
      const start = yield* fs.resolve(location.directory)
      const stop = yield* fs.resolve(location.project.directory)
      const fromProject = relative(stop, start)
      const insideProject =
        fromProject === "" || (fromProject !== ".." && !fromProject.startsWith(`..${sep}`) && !isAbsolute(fromProject))
      const discovered = new Set(
        yield* Effect.forEach(
          Flag.OPENCODE_DISABLE_PROJECT_CONFIG || !insideProject
            ? []
            : yield* fs.up({
                targets: ["AGENTS.md"],
                start,
                stop,
              }),
          fs.resolve,
        ),
      )
      const instructions = Array.dedupe(
        (yield* config.entries()).flatMap((entry) => {
          if (entry.type !== "document") return []
          if (
            (Flag.OPENCODE_DISABLE_PROJECT_CONFIG || !insideProject) &&
            entry.path &&
            !FSUtil.contains(global.config, entry.path)
          )
            return []
          return entry.info.instructions ?? []
        }),
      )
      const urls = instructions.filter((instruction) => /^https?:\/\//.test(instruction))
      const additional = yield* Effect.forEach(
        instructions.filter((instruction) => !urls.includes(instruction)),
        (raw) => {
          const instruction = raw.startsWith("~/") ? join(global.home, raw.slice(2)) : raw
          return isAbsolute(instruction)
            ? fs.glob(basename(instruction), { cwd: dirname(instruction), absolute: true, include: "file", dot: true })
            : insideProject
              ? fs.globUp(instruction, start, stop)
              : Effect.succeed([])
        },
      )
      additional.flat().forEach((path) => discovered.add(path))
      const paths = Array.dedupe([...(yield* Effect.forEach(Global.instructionFiles(global), fs.resolve)), ...discovered])
      const files = yield* Effect.forEach(
        paths,
        (path) =>
          fs
            .readFileStringSafe(path)
            .pipe(
              Effect.map((content) =>
                content === undefined ? undefined : new File({ path: AbsolutePath.make(path), content }),
              ),
            ),
        { concurrency: "unbounded" },
      )
      if (files.some((file, index) => file === undefined && discovered.has(paths[index])))
        return SystemContext.unavailable
      const remote = yield* Effect.forEach(
        urls,
        (url) =>
          http.get(url).pipe(
            Effect.flatMap((response) => response.text),
            Effect.map((content) => new File({ path: url, content })),
            Effect.provideService(HttpIncomingMessage.MaxBodySize, FileSystem.Size(1024 * 1024)),
            Effect.timeout("10 seconds"),
          ),
        { concurrency: 4 },
      )
      return [...files.filter((file): file is File => file !== undefined), ...remote]
    })

    yield* registry.register({
      key,
      load: observe().pipe(
        Effect.map((files) =>
          files === SystemContext.unavailable
            ? source(files)
            : files.length === 0
              ? SystemContext.empty
              : source(files),
        ),
        Effect.catch(() => Effect.succeed(source(SystemContext.unavailable))),
        Effect.catchDefect(() => Effect.succeed(source(SystemContext.unavailable))),
      ),
    })
  }),
)

export const node = makeLocationNode({
  name: "instruction-context",
  layer,
  deps: [
    FSUtil.node,
    Global.node,
    Location.node,
    SystemContextRegistry.node,
    Config.node,
    LayerNodePlatform.httpClient,
  ],
})

function render(files: ReadonlyArray<File>) {
  return files.map((file) => `Instructions from: ${file.path}\n${file.content}`).join("\n\n")
}
