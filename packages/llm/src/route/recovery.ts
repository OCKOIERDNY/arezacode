import { Clock, Context, Effect, Stream } from "effect"
import { LLMError, TransportReason, type LLMEvent } from "../schema"
import { RequestExecutor } from "./executor"

export class StallPolicy extends Context.Reference<{
  readonly timeoutMs: number
  readonly retries: number
  readonly backoffMs: number
}>("@opencode/LLM/StallPolicy", {
  defaultValue: () => ({ timeoutMs: 300_000, retries: 1, backoffMs: 1_000 }),
}) {}

export const recoverStalls = <E, R>(
  stream: Stream.Stream<LLMEvent, E, R>,
  options: { readonly retrySafe: boolean; readonly abort?: Effect.Effect<void> },
  attempt = 0,
): Stream.Stream<LLMEvent, E | LLMError, R> =>
  Stream.unwrap(Effect.gen(function* () {
    const policy = yield* StallPolicy
    const abort = options.abort
    let received = false
    return stream.pipe(
      (source) => Stream.transformPull(source, (pull) => Effect.succeed(abort ? pull.pipe(Effect.onInterrupt(() => abort)) : pull)),
      Stream.tap(() => Effect.sync(() => { received = true })),
      Stream.timeoutOrElse({
        duration: policy.timeoutMs,
        orElse: () => Stream.unwrap(Effect.gen(function* () {
          const phase = received ? "stream" : "first-event"
          if (abort) yield* abort
          yield* RequestExecutor.observe({ type: "stall", time: yield* Clock.currentTimeMillis, phase, timeoutMs: policy.timeoutMs })
          if (received || attempt >= policy.retries || !options.retrySafe) {
            return yield* new LLMError({
              module: "RequestRecovery",
              method: "stream",
              reason: new TransportReason({
                kind: "StallTimeout",
                message: `Provider request stalled for ${policy.timeoutMs}ms while waiting for ${phase}. Any partial output has been retained; the request was stopped.`,
              }),
            })
          }
          yield* RequestExecutor.observe({
            type: "retry", time: yield* Clock.currentTimeMillis, attempt: attempt + 1,
            reason: "StallTimeout", delayMs: policy.backoffMs,
          })
          yield* Effect.sleep(policy.backoffMs)
          return recoverStalls(stream, options, attempt + 1)
        })),
      }),
    )
  }))
