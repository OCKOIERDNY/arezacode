import { expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Global } from "@opencode-ai/core/global"
import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { GlobTool } from "@opencode-ai/core/tool/glob"
import { GrepTool } from "@opencode-ai/core/tool/grep"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { executeTool, toolIdentity } from "./lib/tool"

for (const name of ["grep", "glob"] as const) {
  it.live(`${name} authorizes canonical external targets and rejects escaping paths before search`, () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const directory = path.join(tmp.path, "project")
      const outside = path.join(tmp.path, "outside")
      yield* Effect.promise(async () => {
        await fs.mkdir(directory)
        await fs.mkdir(outside)
        await fs.writeFile(path.join(outside, "output.txt"), "needle")
        if (process.platform !== "win32") await fs.symlink(outside, path.join(directory, "escape"))
      })
      const assertions: PermissionV2.AssertInput[] = []
      const searches: string[] = []
      let allow = false
      const permission = Layer.succeed(PermissionV2.Service, PermissionV2.Service.of({
        assert: (input) => Effect.suspend(() => {
          assertions.push(input)
          return input.action === "external_directory" && !allow
            ? Effect.fail(new PermissionV2.BlockedError({ rules: [] }))
            : Effect.void
        }),
        ask: () => Effect.die("unused"),
        reply: () => Effect.die("unused"),
        get: () => Effect.die("unused"),
        forSession: () => Effect.die("unused"),
        list: () => Effect.die("unused"),
      }))
      const search = (input: { cwd: string }) => Effect.sync(() => {
        searches.push(input.cwd)
        return []
      })
      const layer = AppNodeBuilder.build(LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, name === "grep" ? GrepTool.node : GlobTool.node]), [
        [Location.node, Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) })))],
        [PermissionV2.node, permission],
        [Ripgrep.node, Layer.succeed(Ripgrep.Service, Ripgrep.Service.of({ find: search, glob: search, grep: search }))],
        [Global.node, Global.layerWith({ data: Global.Path.data })],
        [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
      ])
      yield* Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const run = (target: string) => executeTool(registry, {
          sessionID: SessionV2.ID.make("ses_search_permissions"),
          ...toolIdentity,
          call: { type: "tool-call", id: "call-search", name, input: { path: target, pattern: "needle" } },
        })
        yield* run(".")
        expect(searches).toEqual([yield* Effect.promise(() => fs.realpath(directory))])
        expect(assertions.map((item) => item.action)).toEqual([name])
        searches.length = 0
        assertions.length = 0
        yield* run(outside)
        expect(searches).toEqual([])
        expect(assertions.map((item) => item.action)).toEqual(["external_directory"])
        yield* run("../outside")
        if (process.platform !== "win32") yield* run("escape")
        expect(searches).toEqual([])
        allow = true
        assertions.length = 0
        yield* run(name === "grep" ? path.join(outside, "output.txt") : outside)
        expect(searches).toEqual([yield* Effect.promise(() => fs.realpath(outside))])
        expect(assertions.map((item) => item.action)).toEqual(["external_directory", name])
        expect(assertions[0]?.resources).toEqual([path.join(yield* Effect.promise(() => fs.realpath(outside)), "*").replaceAll("\\", "/")])
        searches.length = 0
        if (name === "grep") {
          yield* run(path.join(outside, "missing.txt"))
          expect(searches).toEqual([])
        }
      }).pipe(Effect.provide(layer))
    }),
  )
}
