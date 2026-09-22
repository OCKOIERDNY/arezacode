import { describe, expect, test } from "bun:test"
import { FileSystem } from "../src/filesystem"
import { Jev } from "../src/jev"
import { Schema } from "effect"

describe("schema compatibility", () => {
  test("Jev task sizing is optional for older responses and validates category values", () => {
    const decode = Schema.decodeUnknownSync(Jev.Prepared)
    expect(decode({ status: "ready", skills: [] }).task).toBeUndefined()
    expect(decode({ status: "ready", skills: [], task: { kind: "cosmetic", relation: "followup" } }).task).toEqual({ kind: "cosmetic", relation: "followup" })
    expect(() => decode({ status: "ready", skills: [], task: { kind: "skip-security", relation: "followup" } })).toThrow()
    expect(Schema.encodeSync(Jev.Prepared)({ status: "ready", skills: [], task: undefined })).not.toHaveProperty("task")
  })
  test("moved class schemas remain constructible", () => {
    const input = new FileSystem.FindInput({ query: "src" })
    expect(input).toBeInstanceOf(FileSystem.FindInput)
    expect(input.query).toBe("src")
  })
})
