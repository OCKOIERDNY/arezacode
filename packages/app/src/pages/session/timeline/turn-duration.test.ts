import { expect, test } from "bun:test"
import { getTurnDurationMs } from "./turn-duration"

test("ticks while working across provider turns and retry waits", () => {
  const messages = [{ time: { completed: 3000 } }, { time: {} }]
  expect(getTurnDurationMs(1000, messages, 8000)).toBe(7000)
  expect(getTurnDurationMs(1000, messages, 9000)).toBe(8000)
})

test("freezes at the latest persisted completion after finishing or stopping", () => {
  expect(getTurnDurationMs(1000, [{ time: { completed: 7000 } }, { time: { completed: 3000 } }])).toBe(6000)
  expect(getTurnDurationMs(1000, [{ time: { completed: 7000 } }])).toBe(6000)
})

test("does not invent a duration for idle unanswered messages", () => {
  expect(getTurnDurationMs(1000, [])).toBeUndefined()
  expect(getTurnDurationMs(1000, [{ time: {} }])).toBeUndefined()
  expect(getTurnDurationMs(1000, [], 2000)).toBe(1000)
})

test("handles timestamp skew and invalid completion records", () => {
  expect(getTurnDurationMs(2000, [], 1000)).toBe(0)
  expect(getTurnDurationMs(1000, [{ time: { completed: Number.NaN } }])).toBeUndefined()
})
