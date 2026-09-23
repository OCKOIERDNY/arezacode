import { appendFile } from "node:fs/promises"

const text = await Bun.stdin.text()
await appendFile(process.argv[2], "call\n")
await Bun.sleep(text.startsWith("cancel") ? 3000 : 40)
if (text.startsWith("failure")) process.exit(1)
if (text.startsWith("malformed")) {
  process.stdout.write("not-json")
  process.exit(0)
}
process.stdout.write(JSON.stringify(
  text.startsWith("compressed") ? text.slice(0, text.length * 0.89)
    : text.startsWith("boundary") ? text.slice(0, text.length * 0.9)
    : text.startsWith("retrieval") ? "<<ccr:missing-original>>"
    : text.startsWith("blank") ? " "
    : text.startsWith("invalid") ? { content: text }
    : text,
))
