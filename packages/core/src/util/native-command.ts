import { spawn } from "node:child_process"
import { homedir } from "node:os"
import path from "node:path"
import which from "which"
import { createHash, randomUUID } from "node:crypto"
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { Schema } from "effect"
import { Integration } from "@opencode-ai/schema/integration"
import { Global } from "../global"
import { Shell } from "../shell"

export const engineVersions = {
  markitdown: "0.1.7",
  headroom: "0.37.0",
  semgrep: "1.176.0",
  entire: "0.10.6",
  context7: "remote",
  ponytail: "native",
} as const
type EngineID = typeof Integration.EngineID.Type
const engineRoot = path.join(Global.Path.data, "engines")
const settingsFile = path.join(Global.Path.config, "engines.json")
const jobs = new Map<EngineID, { controller: AbortController; task: Promise<void> }>()
const outcomes = new Map<EngineID, { error?: string; lastResult?: string; updatedAt: number }>()
const runtimes = new Map<string, Promise<string>>()
const sizes = new Map<EngineID, { bytes: number; at: number }>()
const active = new Map<EngineID, Set<AbortController>>()
let writing = Promise.resolve()
let resultWriting = Promise.resolve()

async function engineSettings() {
  const text = await readFile(settingsFile, "utf8").catch(() => "{}")
  return Schema.decodeUnknownSync(Schema.Record(Schema.String, Integration.EngineSettings))(
    Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(text),
  )
}

async function saveEngine(id: EngineID, patch: Partial<typeof Integration.EngineSettings.Type>) {
  const task = writing.catch(() => {}).then(async () => {
    const settings = await engineSettings()
    const temporary = `${settingsFile}.${randomUUID()}`
    await mkdir(path.dirname(settingsFile), { recursive: true })
    await writeFile(temporary, JSON.stringify({ ...settings, [id]: { ...(settings[id] ?? { enabled: true }), ...patch } }), { mode: 0o600 })
    await rename(temporary, settingsFile)
  })
  writing = task
  await task
}

export async function engineEnabled(id: EngineID) {
  return engineSettings().then((settings) => settings[id]?.enabled ?? true).catch(() => false)
}

const engineExecutable = (id: EngineID, directory: string) =>
  id === "entire" ? path.join(directory, "entire")
    : path.join(directory, "venv", process.platform === "win32" ? "Scripts" : "bin", id)

export async function engineStatus() {
  const settings = await engineSettings()
  if (!outcomes.size) {
    const saved = await readFile(path.join(engineRoot, "last-results.json"), "utf8").catch(() => "{}")
    const decoded = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)(saved)
    if (decoded._tag === "Some" && decoded.value && typeof decoded.value === "object") {
      for (const [key, value] of Object.entries(decoded.value)) {
        if (!Schema.is(Integration.EngineID)(key) || !value || typeof value !== "object") continue
        const item = value as { error?: unknown; lastResult?: unknown; updatedAt?: unknown }
        if (typeof item.updatedAt === "number") outcomes.set(key, { updatedAt: item.updatedAt,
          ...(typeof item.error === "string" ? { error: item.error } : {}), ...(typeof item.lastResult === "string" ? { lastResult: item.lastResult } : {}) })
      }
    }
  }
  return Promise.all(Object.entries(engineVersions).map(async ([name, version]) => {
    const id = Schema.decodeUnknownSync(Integration.EngineID)(name)
    const current = settings[id]?.current
    const managed = (id === "ponytail" || id === "context7") || Boolean(current && await stat(engineExecutable(id, path.join(engineRoot, id, current))).catch(() => undefined))
    const installed = managed || Boolean(await which(id, { nothrow: true, path: binaryPath() }))
    if (id !== "ponytail" && id !== "context7" && (!sizes.has(id) || Date.now() - sizes.get(id)!.at > 60_000)) {
      const value = await nativeCommand("du", ["-sk", path.join(engineRoot, id)]).catch(() => "0")
      sizes.set(id, { bytes: (Number.parseInt(value, 10) || 0) * 1024, at: Date.now() })
    }
    return { id, version: current?.split("-")[0] ?? (installed && id !== "ponytail" && id !== "context7" ? "external" : version), enabled: settings[id]?.enabled ?? true, installed, managed,
      running: jobs.has(id) || Boolean(active.get(id)?.size), rollback: Boolean(settings[id]?.previous), storageBytes: sizes.get(id)?.bytes ?? 0, ...outcomes.get(id) }
  }))
}

function binaryPath() {
  return [process.env.PATH, path.join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(path.delimiter)
}

export function engineEnvironment(extra: Record<string, string | undefined> = {}) {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    ["PATH", "HOME", "TMPDIR", "LANG", "SYSTEMROOT", "SSL_CERT_FILE", "SSL_CERT_DIR", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"].includes(key))), ...extra }
}

export async function engineCommand(id: EngineID, args: string[], options: Parameters<typeof nativeCommand>[2] & { interpreter?: string } = {}) {
  if (!(await engineEnabled(id))) throw new Error(`${id} is disabled`)
  const binary = await nativeBinary(id)
  const command = options.interpreter ?? binary
  const controller = new AbortController()
  const controllers = active.get(id) ?? new Set<AbortController>()
  controllers.add(controller)
  active.set(id, controllers)
  try {
    const result = await nativeCommand(command, args, { ...options, env: options.env ?? engineEnvironment(), signal: AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : [])]) })
    await engineResult(id, args[0] ?? "completed")
    return result
  } catch (error) {
    await engineResult(id, undefined, error instanceof Error ? error.message : "Engine operation failed")
    throw error
  } finally {
    controllers.delete(controller)
  }
}

export async function engineResult(id: EngineID, lastResult?: string, error?: string) {
  outcomes.set(id, { lastResult, error, updatedAt: Date.now() })
  const task = resultWriting.catch(() => {}).then(async () => {
    await mkdir(engineRoot, { recursive: true })
    const temporary = path.join(engineRoot, `last-results.${randomUUID()}.json`)
    await writeFile(temporary, JSON.stringify(Object.fromEntries(outcomes)), { mode: 0o600 })
    await rename(temporary, path.join(engineRoot, "last-results.json"))
  })
  resultWriting = task
  await task
}

async function release(repo: string, tag: string, name: string, target: string, signal?: AbortSignal) {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, { signal })
  if (!response.ok) throw new Error(`Cannot load ${repo} release (${response.status})`)
  const data = await response.json() as { assets?: { name: string; digest?: string; browser_download_url: string }[] }
  const asset = data.assets?.find((item) => item.name === name)
  if (!asset?.digest?.startsWith("sha256:") || !asset.browser_download_url.startsWith(`https://github.com/${repo}/releases/download/`))
    throw new Error("No verified engine artifact for this platform")
  await download(asset.browser_download_url, asset.digest.slice(7), target, signal)
}

async function download(url: string, checksum: string, target: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(120_000)]) })
  if (!response.ok || Number(response.headers.get("content-length")) > 256 * 1024 * 1024) throw new Error("Engine download failed")
  const chunks: Uint8Array[] = []
  let size = 0
  if (!response.body) throw new Error("Empty engine download")
  const reader = response.body.getReader()
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    size += chunk.value.length
    if (size > 256 * 1024 * 1024) { await reader.cancel(); throw new Error("Engine download exceeds size limit") }
    chunks.push(chunk.value)
  }
  const content = Buffer.concat(chunks)
  if (!/^[a-f0-9]{64}$/.test(checksum) || createHash("sha256").update(content).digest("hex") !== checksum)
    throw new Error("Engine checksum mismatch")
  await writeFile(target, content, { mode: 0o600 })
}

async function runtime(name: "uv", signal?: AbortSignal): Promise<string> {
  const version = "0.12.1"
  const root = path.join(engineRoot, "runtime", `${name}-${version}`)
  const executable = path.join(root, name)
  if (await stat(executable).catch(() => undefined)) return executable
  const pending = runtimes.get(name)
  if (pending) return pending
  const task = (async () => {
    if (!["darwin", "linux"].includes(process.platform) || !["arm64", "x64"].includes(process.arch))
      throw new Error("Managed engines currently support macOS and Linux on ARM64 and x64")
    const stage = `${root}.${randomUUID()}`
    await mkdir(stage, { recursive: true })
    try {
      const archive = path.join(stage, "download.tar.gz")
      const arch = process.arch === "arm64" ? "aarch64" : "x86_64"
      await release("astral-sh/uv", version, `uv-${arch}-${process.platform === "darwin" ? "apple-darwin" : "unknown-linux-gnu"}.tar.gz`, archive, signal)
      await nativeCommand("tar", ["-xzf", archive, "-C", stage], { signal })
      const directory = (await readdir(stage, { withFileTypes: true })).find((item) => item.isDirectory())?.name
      if (!directory) throw new Error("Engine archive has no runtime")
      await rename(path.join(stage, directory, name), path.join(stage, name))
      await chmod(path.join(stage, name), 0o700)
      await rm(archive)
      await rm(path.join(stage, directory), { recursive: true })
      await rename(stage, root)
      return executable
    } finally {
      await rm(stage, { recursive: true, force: true })
    }
  })()
  runtimes.set(name, task)
  return task.finally(() => runtimes.delete(name))
}

export async function engineAction(id: EngineID, action: typeof Integration.EngineAction.Type["action"]) {
  if (action === "cancel") { jobs.get(id)?.controller.abort(); active.get(id)?.forEach((item) => item.abort()); return }
  if (action === "enable" || action === "disable") {
    if (action === "disable") { jobs.get(id)?.controller.abort(); active.get(id)?.forEach((item) => item.abort()) }
    await saveEngine(id, { enabled: action === "enable" })
    return
  }
  if (id === "context7") throw new Error("Context7 is a hosted tool; enable or disable its connection instead")
  if (jobs.has(id)) return
  const controller = new AbortController()
  const task = (async () => {
    outcomes.delete(id)
    try {
      const settings = (await engineSettings())[id]
      if (action === "rollback") {
        if (!settings?.previous) throw new Error("No previous engine installation")
        const executable = engineExecutable(id, path.join(engineRoot, id, settings.previous))
        await nativeCommand(executable,
          [id === "entire" ? "version" : "--version"],
          { signal: controller.signal, env: engineEnvironment() })
        await saveEngine(id, { current: settings.previous, previous: settings.current })
      }
      if (action === "install" && id !== "ponytail") {
        const revision = `${engineVersions[id]}-${randomUUID()}`
        const stage = path.join(engineRoot, id, revision)
        await mkdir(stage, { recursive: true })
        try {
          if (id === "entire") {
            const archive = path.join(stage, "entire.tar.gz")
            await release("entireio/cli", `v${engineVersions.entire}`, `entire_${process.platform}_${process.arch === "x64" ? "amd64" : process.arch}.tar.gz`, archive, controller.signal)
            await nativeCommand("tar", ["-xzf", archive, "-C", stage], { signal: controller.signal })
            await rm(archive)
          } else {
            const uv = await runtime("uv", controller.signal)
            const env = engineEnvironment({ UV_PYTHON_INSTALL_DIR: path.join(engineRoot, "runtime", "python"), UV_NO_PROGRESS: "1" })
            await nativeCommand(uv, ["venv", "--python", "3.12.12", "--managed-python", path.join(stage, "venv")], { env, signal: controller.signal, timeout: 180_000 })
            await nativeCommand(uv, ["pip", "install", "--python", path.join(stage, "venv/bin/python"), `${id === "headroom" ? "headroom-ai" : id === "markitdown" ? "markitdown[all]" : id}==${engineVersions[id]}`], { env, signal: controller.signal, timeout: 300_000 })
          }
          const executable = engineExecutable(id, stage)
          await nativeCommand(executable, [id === "entire" ? "version" : "--version"], { signal: controller.signal, timeout: 30_000, env: engineEnvironment() })
          await saveEngine(id, { enabled: true, current: revision, previous: settings?.current })
        } catch (error) {
          await rm(stage, { recursive: true, force: true })
          throw error
        }
      }
      if (action === "check" && id !== "ponytail") {
        const executable = await nativeBinary(id)
        await nativeCommand(executable,
          [id === "entire" ? "version" : "--version"],
          { signal: controller.signal, env: engineEnvironment() })
      }
      await engineResult(id, action)
    } catch (error) {
      await engineResult(id, undefined, controller.signal.aborted ? "Cancelled" : error instanceof Error ? error.message : "Engine operation failed")
    } finally {
      jobs.delete(id)
    }
  })()
  jobs.set(id, { controller, task })
}

export async function engineWait(id: EngineID) { await jobs.get(id)?.task }

export async function nativeBinary(name: string) {
  if (Object.hasOwn(engineVersions, name) && name !== "ponytail") {
    const id = Schema.decodeUnknownSync(Integration.EngineID)(name)
    const current = (await engineSettings())[id]?.current
    if (current) return engineExecutable(id, path.join(engineRoot, id, current))
  }
  return which(name, {
    path: [process.env.PATH, path.join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"]
      .filter(Boolean)
      .join(path.delimiter),
  })
}

export function nativeCommand(
  command: string,
  args: string[],
  options: { cwd?: string; input?: string; env?: NodeJS.ProcessEnv; timeout?: number; signal?: AbortSignal } = {},
) {
  return new Promise<string>((resolve, reject) => {
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : [])])
    if (signal.aborted) {
      reject(new Error(`${path.basename(command)} failed (cancelled or timed out); no successful result was recorded.`))
      return
    }
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    })
    const chunks: Buffer[] = []
    let size = 0
    let failure: Error | undefined
    let stopping: Promise<void> | undefined
    const stop = () => {
      stopping ??= Shell.killTree(child)
      return stopping
    }
    const exit = () => {
      if (!child.pid) return
      if (process.platform === "win32") { child.kill(); return }
      try { process.kill(-child.pid, "SIGKILL") } catch {}
    }
    const abort = () => { void stop() }
    const timer = setTimeout(() => controller.abort(), options.timeout ?? 30_000)
    signal.addEventListener("abort", abort, { once: true })
    process.once("exit", exit)
    const collect = (data: Buffer, stdout: boolean) => {
      size += data.length
      if (size > 16 * 1024 * 1024) { controller.abort(); return }
      if (stdout) chunks.push(data)
    }
    child.stdout.on("data", (data: Buffer) => collect(data, true))
    child.stderr.on("data", (data: Buffer) => collect(data, false))
    child.on("error", (error) => { failure = error })
    child.on("close", async (code) => {
      clearTimeout(timer)
      signal.removeEventListener("abort", abort)
      if (code !== 0 || failure || signal.aborted) {
        await stop()
        process.removeListener("exit", exit)
        reject(new Error(`${path.basename(command)} failed (${signal.aborted ? "cancelled or timed out" : code ?? "unavailable"}); no successful result was recorded.`))
        return
      }
      process.removeListener("exit", exit)
      resolve(Buffer.concat(chunks).toString("utf8"))
    })
    child.stdin.on("error", () => {})
    child.stdin.end(options.input)
  })
}
