import { expect, test } from "bun:test"
import { resizeKey } from "./resize-key"

const base = { size: 300, min: 220, max: 480, direction: "horizontal", rtl: false } as const

test("horizontal resizing follows the physical arrow and logical edge in LTR and RTL", () => {
  expect(resizeKey({ ...base, key: "ArrowRight" })).toBe(316)
  expect(resizeKey({ ...base, key: "ArrowLeft" })).toBe(284)
  expect(resizeKey({ ...base, edge: "start", key: "ArrowRight" })).toBe(284)
  expect(resizeKey({ ...base, rtl: true, key: "ArrowRight" })).toBe(284)
  expect(resizeKey({ ...base, rtl: true, edge: "start", key: "ArrowRight" })).toBe(316)
})

test("vertical resizing is independent of text direction", () => {
  expect(resizeKey({ ...base, direction: "vertical", key: "ArrowUp" })).toBe(316)
  expect(resizeKey({ ...base, direction: "vertical", rtl: true, key: "ArrowDown" })).toBe(284)
  expect(resizeKey({ ...base, direction: "vertical", edge: "end", key: "ArrowDown" })).toBe(316)
})

test("keyboard resizing clamps bounds, supports Home/End, and ignores unrelated keys", () => {
  expect(resizeKey({ ...base, size: 475, key: "ArrowRight" })).toBe(480)
  expect(resizeKey({ ...base, size: 225, key: "ArrowLeft" })).toBe(220)
  expect(resizeKey({ ...base, key: "Home" })).toBe(220)
  expect(resizeKey({ ...base, key: "End" })).toBe(480)
  expect(resizeKey({ ...base, key: "ArrowDown" })).toBeUndefined()
  expect(resizeKey({ ...base, key: "Tab" })).toBeUndefined()
})
