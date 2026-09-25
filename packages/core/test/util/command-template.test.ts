import { expect, test } from "bun:test"
import { expandCommandTemplate } from "../../src/util/command-template"

test.each([
  ["Review $ARGUMENTS", "a $& b", "Review a $& b"],
  ["Review $1 and $2", "$ARGUMENTS literal", "Review $ARGUMENTS and literal"],
  ["Review $0 then $1", "first second", "Review  then first second"],
  ["Compare $1 with $2", '"first file" second third', "Compare first file with second third"],
  ["Review $1 then $2", "first", "Review first then "],
  ["Review", "staged changes", "Review\n\nstaged changes"],
  ["Review", "", "Review"],
])("expands command arguments: %s", (template, args, expected) => {
  expect(expandCommandTemplate(template, args)).toBe(expected)
})
