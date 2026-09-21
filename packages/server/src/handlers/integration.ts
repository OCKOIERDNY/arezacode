import { Integration } from "@opencode-ai/core/integration"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { InvalidRequestError } from "@opencode-ai/protocol/errors"
import { response } from "../location"
import { engineAction, engineStatus } from "@opencode-ai/core/util/native-command"

const operation = <A>(run: (signal: AbortSignal) => Promise<A>) => Effect.tryPromise({
  try: run,
  catch: (error) => new InvalidRequestError({ kind: "local_engine", message: error instanceof Error ? error.message : "Engine operation failed" }),
})

const authorize = <A, R>(effect: Effect.Effect<A, Integration.AuthorizationError, R>) =>
  effect.pipe(
    Effect.mapError(
      () =>
        new InvalidRequestError({
          message: "Authentication failed",
          kind: "integration_authorization",
        }),
    ),
  )

export const IntegrationHandler = HttpApiBuilder.group(Api, "server.integration", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle("integration.toolsList", () => Effect.promise(engineStatus))
      .handle("integration.toolsAction", (ctx) => operation(async () => {
        await engineAction(ctx.params.engineID, ctx.payload.action)
        return engineStatus()
      }))
      .handle(
        "integration.list",
        Effect.fn(function* () {
          const service = yield* Integration.Service
          return yield* response(service.list())
        }),
      )
      .handle(
        "integration.get",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          return yield* response(service.get(ctx.params.integrationID))
        }),
      )
      .handle(
        "integration.connect.key",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          yield* authorize(
            service.connection.key({
              integrationID: ctx.params.integrationID,
              key: ctx.payload.key,
              label: ctx.payload.label,
            }),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "integration.connect.oauth",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          return yield* response(
            authorize(
              service.connection.oauth({
                integrationID: ctx.params.integrationID,
                methodID: ctx.payload.methodID,
                inputs: ctx.payload.inputs,
                label: ctx.payload.label,
              }),
            ),
          )
        }),
      )
      .handle(
        "integration.attempt.status",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          return yield* response(service.attempt.status(ctx.params.attemptID))
        }),
      )
      .handle(
        "integration.attempt.complete",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          yield* service.attempt.complete({ attemptID: ctx.params.attemptID, code: ctx.payload.code }).pipe(
            Effect.mapError(
              (error) =>
                new InvalidRequestError({
                  message:
                    error._tag === "Integration.CodeRequired"
                      ? "Authorization code is required"
                      : "Authentication failed",
                  kind:
                    error._tag === "Integration.CodeRequired"
                      ? "integration_code_required"
                      : "integration_authorization",
                }),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "integration.attempt.cancel",
        Effect.fn(function* (ctx) {
          const service = yield* Integration.Service
          yield* service.attempt.cancel(ctx.params.attemptID)
          return HttpApiSchema.NoContent.make()
        }),
      )
  }),
)
