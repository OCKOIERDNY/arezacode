import { expect, test } from "bun:test"
import { pollHealth } from "./health-poll"

test("stops polling after cancellation, including an in-flight check", async () => {
  const abort = new AbortController()
  let checks = 0
  const polling = pollHealth(
    async (signal) => {
      checks++
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
      return false
    },
    abort.signal,
    1,
  )

  await new Promise((resolve) => setTimeout(resolve, 5))
  abort.abort()
  await polling
  const settled = checks
  await new Promise((resolve) => setTimeout(resolve, 5))
  expect(checks).toBe(settled)
})

test("stops polling once a health check succeeds", async () => {
  const abort = new AbortController()
  let checks = 0

  await pollHealth(async () => ++checks === 2, abort.signal, 1)
  await new Promise((resolve) => setTimeout(resolve, 5))

  expect(checks).toBe(2)
})
