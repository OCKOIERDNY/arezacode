export * as ConfigToolOutput from "./tool-output"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

export const DEFAULT_MAX_LINES = 2_000
export const DEFAULT_MAX_BYTES = 50 * 1024

export const withinLimits = (text: string, limits: { maxLines: number; maxBytes: number }) =>
  text.split("\n").length <= limits.maxLines && Buffer.byteLength(text, "utf-8") <= limits.maxBytes

export const reuse = () => {
  const seen = new Map<string, { id: string; output: string }>()
  return (input: { name: string; id: string; arguments: unknown; output: string; error?: boolean }) => {
    if (!["read", "glob", "grep"].includes(input.name) || (!input.error && input.output.length < 256)) return
    const key = JSON.stringify([input.name, input.arguments, input.error === true])
    const previous = seen.get(key)
    if (previous?.output === input.output && previous.id !== input.id) {
      const reference = input.error
        ? `Same error as ${input.name} call ${previous.id} in this history.`
        : `Unchanged result; see ${input.name} tool call ${previous.id} in this history. This call returned exactly the same content.`
      if (reference.length < input.output.length) return reference
    }
    seen.set(key, { id: input.id, output: input.output })
  }
}

export class Info extends Schema.Class<Info>("ConfigV2.ToolOutput")({
  max_lines: PositiveInt.pipe(Schema.optional),
  max_bytes: PositiveInt.pipe(Schema.optional),
}) {}
