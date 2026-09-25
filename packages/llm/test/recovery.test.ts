import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Ref, Stream } from "effect"
import { TestClock } from "effect/testing"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { LLM, LLMEvent, ToolResultValue } from "../src"
import { LLMClient, RequestExecutor } from "../src/route"
import { route } from "../src/protocols/openai-chat"
import { recoverStalls, StallPolicy } from "../src/route/recovery"
import { it } from "./lib/effect"
import { deltaChunk, finishChunk } from "./lib/openai-chunks"

const request = LLM.request({
  model: route.with({ endpoint: { baseURL: "https://provider.test" } }).model({ id: "test" }),
  prompt: "Hello",
})
const policy = { timeoutMs: 1_000, retries: 1, backoffMs: 100 }

describe("stalled request recovery", () => {
  it.effect("waits for all local tools and resumes the provider deadline after approval or rejection", () =>
    Effect.gen(function* () {
      const first = yield* Deferred.make<void>()
      const second = yield* Deferred.make<void>()
      const waiting = yield* Deferred.make<void>()
      const settled = yield* Deferred.make<void>()
      const aborted = yield* Ref.make(false)
      const stream = Stream.fromIterable<Stream.Stream<LLMEvent>>([
        Stream.fromIterable([
          LLMEvent.toolCall({ id: "first", name: "glob", input: {} }),
          LLMEvent.toolCall({ id: "second", name: "bash", input: {} }),
        ]),
        Stream.fromEffect(
          Deferred.succeed(waiting, undefined).pipe(
            Effect.andThen(Deferred.await(first)),
            Effect.as(LLMEvent.toolResult({ id: "first", name: "glob", result: ToolResultValue.make("approved") })),
          ),
        ),
        Stream.fromEffect(
          Deferred.await(second).pipe(Effect.as(LLMEvent.toolError({ id: "second", name: "bash", message: "denied" }))),
        ),
        Stream.fromEffect(Deferred.succeed(settled, undefined).pipe(Effect.andThen(Effect.never))),
      ]).pipe(Stream.flatMap((stream) => stream))
      const fiber = yield* recoverStalls(stream, {
        retrySafe: false,
        executesTools: true,
        abort: Ref.set(aborted, true),
      }).pipe(Stream.runDrain, Effect.flip, Effect.provideService(StallPolicy, policy), Effect.forkChild)
      yield* Deferred.await(waiting)
      yield* TestClock.adjust(10_000)
      expect(yield* Ref.get(aborted)).toBe(false)
      yield* Deferred.succeed(first, undefined)
      yield* TestClock.adjust(10_000)
      expect(yield* Ref.get(aborted)).toBe(false)
      yield* Deferred.succeed(second, undefined)
      yield* Deferred.await(settled)
      yield* TestClock.adjust(1_000)
      expect((yield* Fiber.join(fiber)).reason).toMatchObject({ kind: "StallTimeout" })
      expect(yield* Ref.get(aborted)).toBe(true)
    }),
  )

  it.effect("still times out provider-executed tools", () =>
    Effect.gen(function* () {
      const stream = Stream.concat(
        Stream.succeed(LLMEvent.toolCall({ id: "remote", name: "search", input: {}, providerExecuted: true })),
        Stream.fromEffect(Effect.never),
      )
      const fiber = yield* recoverStalls(stream, { retrySafe: false, executesTools: true }).pipe(
        Stream.runDrain,
        Effect.flip,
        Effect.provideService(StallPolicy, policy),
        Effect.forkChild,
      )
      yield* TestClock.adjust(1_000)
      expect((yield* Fiber.join(fiber)).reason).toMatchObject({ kind: "StallTimeout" })
    }),
  )

  it.effect("allows cancellation while a local tool is awaiting approval", () =>
    Effect.gen(function* () {
      const waiting = yield* Deferred.make<void>()
      const aborted = yield* Ref.make(false)
      const stream = Stream.concat(
        Stream.succeed(LLMEvent.toolCall({ id: "local", name: "glob", input: {} })),
        Stream.fromEffect(Deferred.succeed(waiting, undefined).pipe(Effect.andThen(Effect.never))),
      )
      const fiber = yield* recoverStalls(stream, {
        retrySafe: false,
        executesTools: true,
        abort: Ref.set(aborted, true),
      }).pipe(Stream.runDrain, Effect.provideService(StallPolicy, policy), Effect.forkChild)
      yield* Deferred.await(waiting)
      yield* Fiber.interrupt(fiber)
      expect(yield* Ref.get(aborted)).toBe(true)
    }),
  )

  it.effect("interrupts a stalled HTTP dispatch before retrying and completes the replacement", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const cancelled = yield* Ref.make(false)
      const timings: RequestExecutor.TimingEvent[] = []
      const http = HttpClient.make((input) =>
        Effect.gen(function* () {
          const attempt = yield* Ref.getAndUpdate(attempts, (value) => value + 1)
          if (attempt === 0) return yield* Effect.never.pipe(Effect.ensuring(Ref.set(cancelled, true)))
          expect(yield* Ref.get(cancelled)).toBe(true)
          return HttpClientResponse.fromWeb(
            input,
            new Response(
              [deltaChunk({ role: "assistant", content: "Hello" }), finishChunk("stop")]
                .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
                .join("") + "data: [DONE]\n\n",
            ),
          )
        }),
      )
      const fiber = yield* LLMClient.generate(request).pipe(
        Effect.provide(
          LLMClient.layer.pipe(
            Layer.provide(RequestExecutor.layer),
            Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
          ),
        ),
        Effect.provideService(StallPolicy, policy),
        Effect.provideService(RequestExecutor.Observer, (event) =>
          Effect.sync(() => {
            timings.push(event)
          }),
        ),
        Effect.forkChild,
      )
      yield* TestClock.adjust(1_000)
      yield* TestClock.adjust(100)
      const response = yield* Fiber.join(fiber)
      expect(
        response.events
          .filter(LLMEvent.is.textDelta)
          .map((event) => event.text)
          .join(""),
      ).toBe("Hello")
      expect(yield* Ref.get(attempts)).toBe(2)
      expect(timings).toContainEqual(expect.objectContaining({ type: "retry", reason: "StallTimeout", delayMs: 100 }))
    }),
  )

  it.effect("retains partial output and never retries after an emitted event", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const received = yield* Deferred.make<void>()
      const seen: LLMEvent[] = []
      const event = LLMEvent.textDelta({ id: "text", text: "Already written" })
      const stream = Stream.unwrap(
        Ref.update(attempts, (value) => value + 1).pipe(
          Effect.as(Stream.concat(Stream.succeed(event), Stream.fromEffect(Effect.never))),
        ),
      )
      const fiber = yield* recoverStalls(stream, { retrySafe: true }).pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            seen.push(event)
          }).pipe(Effect.andThen(Deferred.succeed(received, undefined))),
        ),
        Effect.flip,
        Effect.provideService(StallPolicy, policy),
        Effect.forkChild,
      )
      yield* Deferred.await(received)
      yield* TestClock.adjust(1_000)
      const error = yield* Fiber.join(fiber)
      expect(error.reason).toMatchObject({ kind: "StallTimeout", retryable: false })
      expect(seen).toEqual([event])
      expect(yield* Ref.get(attempts)).toBe(1)
    }),
  )

  it.effect("bounds repeated stalls", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const stream = Stream.fromEffect(Ref.update(attempts, (value) => value + 1).pipe(Effect.andThen(Effect.never)))
      const fiber = yield* recoverStalls(stream, { retrySafe: true }).pipe(
        Stream.runDrain,
        Effect.flip,
        Effect.provideService(StallPolicy, policy),
        Effect.forkChild,
      )
      yield* TestClock.adjust(1_000)
      yield* TestClock.adjust(100)
      yield* TestClock.adjust(1_000)
      const error = yield* Fiber.join(fiber)
      expect(error.reason).toMatchObject({ kind: "StallTimeout" })
      expect(yield* Ref.get(attempts)).toBe(2)
    }),
  )

  it.effect("does not retry when the caller cannot guarantee replay safety", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const stream = Stream.fromEffect(Ref.update(attempts, (value) => value + 1).pipe(Effect.andThen(Effect.never)))
      const fiber = yield* recoverStalls(stream, { retrySafe: false }).pipe(
        Stream.runDrain,
        Effect.flip,
        Effect.provideService(StallPolicy, policy),
        Effect.forkChild,
      )
      yield* TestClock.adjust(1_000)
      yield* Fiber.join(fiber)
      expect(yield* Ref.get(attempts)).toBe(1)
    }),
  )

  it.effect("cancels backoff without starting another request", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const stream = Stream.fromEffect(Ref.update(attempts, (value) => value + 1).pipe(Effect.andThen(Effect.never)))
      const fiber = yield* recoverStalls(stream, { retrySafe: true }).pipe(
        Stream.runDrain,
        Effect.provideService(StallPolicy, policy),
        Effect.forkChild,
      )
      yield* TestClock.adjust(1_000)
      yield* Fiber.interrupt(fiber)
      yield* TestClock.adjust(10_000)
      expect(yield* Ref.get(attempts)).toBe(1)
    }),
  )

  it.effect("aborts an SDK iterator before waiting for its cleanup", () =>
    Effect.gen(function* () {
      const controller = new AbortController()
      const done = Promise.withResolvers<IteratorResult<LLMEvent>>()
      controller.signal.addEventListener("abort", () => done.resolve({ done: true, value: undefined }), { once: true })
      const stream = Stream.fromAsyncIterable(
        {
          [Symbol.asyncIterator]() {
            return { next: () => done.promise, return: () => done.promise }
          },
        },
        (error) => error,
      )
      const fiber = yield* recoverStalls(stream, {
        retrySafe: false,
        abort: Effect.sync(() => controller.abort()),
      }).pipe(Stream.runDrain, Effect.exit, Effect.provideService(StallPolicy, policy), Effect.forkChild)
      yield* TestClock.adjust(1_000)
      const result = yield* Fiber.join(fiber)
      expect(result._tag).toBe("Failure")
      expect(controller.signal.aborted).toBe(true)
    }),
  )

  it.effect("resets the deadline while output continues", () =>
    Effect.gen(function* () {
      const stream = Stream.fromIterable(["first", "second", "third"]).pipe(
        Stream.mapEffect((text) => Effect.sleep(750).pipe(Effect.as(LLMEvent.textDelta({ id: "text", text })))),
      )
      const fiber = yield* recoverStalls(stream, { retrySafe: true }).pipe(
        Stream.runCollect,
        Effect.provideService(StallPolicy, policy),
        Effect.forkChild,
      )
      yield* TestClock.adjust(3_000)
      expect((yield* Fiber.join(fiber)).filter(LLMEvent.is.textDelta).map((event) => event.text)).toEqual([
        "first",
        "second",
        "third",
      ])
    }),
  )

  it.effect("does not replay an already executed tool call", () =>
    Effect.gen(function* () {
      const executions = yield* Ref.make(0)
      const completed = yield* Deferred.make<void>()
      const event = LLMEvent.toolCall({ id: "call_1", name: "write", input: { text: "saved" } })
      const stream = Stream.concat(Stream.succeed(event), Stream.fromEffect(Effect.never))
      const fiber = yield* recoverStalls(stream, { retrySafe: true }).pipe(
        Stream.runForEach(() =>
          Ref.update(executions, (value) => value + 1).pipe(Effect.andThen(Deferred.succeed(completed, undefined))),
        ),
        Effect.flip,
        Effect.provideService(StallPolicy, policy),
        Effect.forkChild,
      )
      yield* Deferred.await(completed)
      yield* TestClock.adjust(1_000)
      yield* Fiber.join(fiber)
      expect(yield* Ref.get(executions)).toBe(1)
    }),
  )
})
