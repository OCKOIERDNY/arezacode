import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Effect, Exit, Layer, LayerMap, Schema } from "effect"
import { HttpClient, HttpRouter } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { ProjectRelocation } from "@opencode-ai/core/project/relocation"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { LocationMiddleware, layer, type LocationServices } from "@opencode-ai/server/location"
import { relocationConflict } from "@opencode-ai/server/middleware/project-relocation"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(NodeHttpServer.layerTest, NodeServices.layer))
const api = HttpApi.make("relocation-probe").add(
  HttpApiGroup.make("probe")
    .add(HttpApiEndpoint.get("get", "/probe", { success: Schema.String }))
    .middleware(LocationMiddleware),
)

describe("Project relocation HTTP errors", () => {
  it.live("returns the declared 409 when a moved location is busy", () =>
    Effect.gen(function* () {
      yield* HttpApiBuilder.layer(api).pipe(
        Layer.provide(
          HttpApiBuilder.group(api, "probe", (handlers) => handlers.handle("get", () => Effect.succeed("ok"))),
        ),
        Layer.provide(layer),
        Layer.provide(
          Layer.effect(
            LocationServiceMap.Service,
            LayerMap.make(() =>
              Layer.effectContext<LocationServices, never, never>(
                Effect.die(new ProjectRelocation.BusyError({ directory: AbsolutePath.make("/old") })),
              ),
            ),
          ),
        ),
        HttpRouter.serve,
        Layer.build,
      )
      const response = yield* HttpClient.get("/probe")
      expect(response.status).toBe(409)
      expect(yield* response.json).toEqual({
        _tag: "ConflictError",
        message: "Stop the running sessions before reopening this moved project, then try again.",
        resource: "project",
      })
    }),
  )

  it.effect("preserves unrelated failures and defects", () =>
    Effect.gen(function* () {
      const failure = Effect.fail("unrelated")
      const defect = Effect.die(new Error("unrelated"))
      expect(yield* relocationConflict(failure).pipe(Effect.exit)).toEqual(yield* Effect.exit(failure))
      expect(yield* relocationConflict(defect).pipe(Effect.exit)).toEqual(yield* Effect.exit(defect))
      expect(Exit.isSuccess(yield* relocationConflict(Effect.succeed("ok")).pipe(Effect.exit))).toBe(true)
    }),
  )
})
