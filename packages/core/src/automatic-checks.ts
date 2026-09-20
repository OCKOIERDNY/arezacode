export * as AutomaticChecks from "./automatic-checks"

import { createHash, randomUUID } from "node:crypto"
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { Global } from "./global"
import { nativeBinary, nativeCommand } from "./util/native-command"

const scans = new Map<string, Promise<string>>()
const results = new Map<string, string>()
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex")

export async function files(directory: string) {
  const root = (await nativeCommand("git", ["rev-parse", "--show-toplevel"], { cwd: directory })).trim()
  const [tracked, staged, untracked] = await Promise.all([
    nativeCommand("git", ["diff", "--name-only", "-z"], { cwd: root }),
    nativeCommand("git", ["diff", "--cached", "--name-only", "-z"], { cwd: root }),
    nativeCommand("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: root }),
  ])
  const entries = await Promise.all(
    [...new Set((tracked + staged + untracked).split("\0").filter(Boolean))].map(async (name) => {
      const file = path.resolve(root, name)
      const relative = path.relative(root, file)
      if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) return
      const info = await lstat(file).catch(() => undefined)
      if (!info?.isFile()) return
      const canonical = path.relative(root, await realpath(file))
      if (canonical === ".." || canonical.startsWith(".." + path.sep) || path.isAbsolute(canonical)) return
      if (info.size > 1024 * 1024) return [name, `oversized:${info.size}:${info.mtimeMs}`] as const
      return [name, hash(await readFile(file))] as const
    }),
  )
  return { root, files: new Map(entries.filter((entry) => entry !== undefined)) }
}

export function scan(root: string, changed: Map<string, string>) {
  if (!changed.size) return Promise.resolve("")
  const oversized = [...changed].filter(([, hash]) => hash.startsWith("oversized:"))
  const targets = [...changed].filter(([, hash]) => !hash.startsWith("oversized:")).map(([name]) => name)
  const incomplete = oversized.length
    ? `Semgrep skipped ${oversized.length} changed files larger than 1 MiB; coverage is incomplete.`
    : ""
  if (!targets.length) return Promise.resolve(incomplete)
  const previous = scans.get(root) ?? Promise.resolve("")
  const task = previous
    .catch(() => "")
    .then(async () => {
      const binary = await nativeBinary("semgrep")
      const directory = path.join(Global.Path.cache, "automatic-semgrep")
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const rules = path.join(directory, "default.yaml")
      const cached = await readFile(rules, "utf8").catch(() => undefined)
      if (!cached) {
        const response = await fetch("https://semgrep.dev/c/p/default", { signal: AbortSignal.timeout(30_000) })
        if (!response.ok) throw new Error("Semgrep rules could not be downloaded; scan did not run")
        const text = await response.text()
        if (text.length > 8 * 1024 * 1024 || !/(?:"rules"|rules)\s*:/.test(text))
          throw new Error("Invalid Semgrep rules response")
        const temporary = rules + `.${randomUUID()}.tmp`
        await writeFile(temporary, text, { mode: 0o600 })
        await rename(temporary, rules)
      }
      const key = hash(root + hash(await readFile(rules)) + JSON.stringify([...changed].sort()))
      const hit = results.get(key)
      if (hit !== undefined) return hit
      const output = await nativeCommand(
        binary,
        [
          "scan",
          "--config",
          rules,
          "--json",
          "--metrics",
          "off",
          "--disable-version-check",
          "--no-git-ignore",
          "--timeout",
          "10",
          "--",
          ...targets.map((file) => path.join(root, file)),
        ],
        { cwd: root, timeout: 120_000 },
      )
      const parsed: unknown = JSON.parse(output)
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !("results" in parsed) ||
        !Array.isArray(parsed.results) ||
        !("errors" in parsed) ||
        !Array.isArray(parsed.errors)
      )
        throw new Error("Invalid Semgrep response; scan status is unknown")
      const findings = parsed.results.flatMap((item: unknown) => {
        if (!item || typeof item !== "object") throw new Error("Invalid Semgrep finding")
        const result = item as {
          path?: string
          start?: { line?: number }
          check_id?: string
          extra?: { message?: string; severity?: string }
        }
        if (typeof result.path !== "string" || typeof result.extra?.message !== "string")
          throw new Error("Invalid Semgrep finding")
        return [
          `${path.relative(root, result.path)}:${result.start?.line ?? 1} [${result.extra.severity ?? "WARNING"}] ${result.check_id}: ${result.extra.message}`,
        ]
      })
      const status = [
        findings.length ? `Automatic Semgrep findings (${findings.length}):\n${findings.slice(0, 30).join("\n")}` : "",
        parsed.errors.length ? `Semgrep reported ${parsed.errors.length} scan errors; coverage is incomplete.` : "",
        incomplete,
      ]
        .filter(Boolean)
        .join("\n")
      if (!parsed.errors.length) {
        results.set(key, status)
        if (results.size > 100) results.delete(results.keys().next().value!)
      }
      return status
    })
  scans.set(root, task)
  return task.finally(() => {
    if (scans.get(root) === task) scans.delete(root)
  })
}

export async function compress(text: string) {
  if (text.length < 8000 || text.length > 4 * 1024 * 1024 || process.env.AREZACODE_HEADROOM === "0") return
  const executable = await realpath(await nativeBinary("headroom"))
  const first = (await readFile(executable, "utf8")).split("\n")[0]
  const python = first.startsWith("#!/") ? first.slice(2).trim() : undefined
  if (!python || !path.isAbsolute(python) || !path.basename(python).startsWith("python"))
    throw new Error("Headroom Python environment is unavailable")
  const output = await nativeCommand(
    python,
    [
      "-c",
      "import json,sys\nfrom headroom import compress\nvalue=compress([{'role':'tool','tool_call_id':'output','content':sys.stdin.read()}], model='gpt-4o', protect_recent=0, kompress_model='disabled')\nprint(json.dumps(value.messages[0]['content']))",
    ],
    { input: text, timeout: 15_000, env: { ...process.env, HF_HUB_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1" } },
  )
  const result: unknown = JSON.parse(output)
  if (
    typeof result !== "string" ||
    !result.trim() ||
    result.length >= text.length * 0.9 ||
    /<<ccr:|\[.*headroom_retrieve/.test(result)
  )
    return
  return result
}
