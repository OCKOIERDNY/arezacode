import { execFile, spawn, type ChildProcess } from "node:child_process"
import { readFile, realpath, stat } from "node:fs/promises"
import http from "node:http"
import https from "node:https"
import { basename, isAbsolute, join, parse, relative, sep } from "node:path"
import { promisify } from "node:util"
import type { ProjectService, ProjectServicesState } from "@opencode-ai/app/project-services"

const execute = promisify(execFile)
const launched = new Map<
  string,
  { child: ChildProcess; id: string; command: string; failed: boolean; stopped: boolean }
>()
const starting = new Map<string, Promise<void>>()
const run = (file: string, args: string[], timeout = 5000) =>
  execute(file, args, {
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    encoding: "utf8",
    windowsHide: true,
    ...(file === "docker" && args[0] === "--host"
      ? { env: { ...process.env, DOCKER_CONTEXT: "", DOCKER_HOST: "" } }
      : {}),
  })

export async function listProjectServices(directory: unknown): Promise<ProjectServicesState> {
  const root = await projectDirectory(directory)
  const [processes, docker] = await Promise.allSettled([projectProcesses(root), projectContainers(root)])
  const managed = launched.get(root)
  const children = processes.status === "fulfilled" ? processes.value : []
  const running = managed && managedRunning(managed)
  const owned = running ? children.filter((service) => service.group === managed.child.pid) : []
  const services = [
    ...children.filter((service) => !owned.includes(service)),
    ...(docker.status === "fulfilled" ? docker.value.services : []),
    ...(managed
      ? [
          {
            id: managed.id,
            kind: "process" as const,
            name: managed.command,
            pid: running ? managed.child.pid : undefined,
            running: !!running,
            failed: managed.failed,
            ports: [...new Set(owned.flatMap((service) => service.ports))],
            urls: [],
          },
        ]
      : []),
  ]
  await Promise.all(
    services.map(async (service) => {
      service.urls = (await Promise.all(service.ports.map(previewURL))).filter((url): url is string => !!url)
    }),
  )
  return {
    services,
    launchers: (await projectLaunchers(root))
      .filter((item) => item.id !== managed?.id)
      .map((item) => ({ id: item.id, command: item.command })),
    processes: processes.status === "fulfilled" ? "available" : "unavailable",
    docker: docker.status === "fulfilled" ? docker.value.status : "unavailable",
  }
}

export async function stopProjectService(directory: unknown, id: unknown) {
  const root = await projectDirectory(directory)
  if (typeof id !== "string" || id.length > 1024) throw new Error("Invalid service")
  const managed = launched.get(root)
  if (managed?.id === id) {
    if (!managedRunning(managed) || !managed.child.pid) return
    if (process.platform === "win32") await run("taskkill", ["/pid", String(managed.child.pid), "/t"])
    if (process.platform !== "win32") process.kill(-managed.child.pid, "SIGTERM")
    for (let attempt = 0; attempt < 50; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      try {
        process.kill(process.platform === "win32" ? managed.child.pid : -managed.child.pid, 0)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") {
          managed.failed = false
          managed.stopped = true
          return
        }
        throw error
      }
    }
    throw new Error("Service did not stop")
  }
  if (id.startsWith("process:")) {
    const service = (await projectProcesses(root)).find((item) => item.id === id)
    if (!service?.pid) throw new Error("Service changed")
    process.kill(service.pid, "SIGTERM")
    for (let attempt = 0; attempt < 50; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      try {
        process.kill(service.pid, 0)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return
        throw error
      }
    }
    throw new Error("Service did not stop")
  }
  const current = await projectContainers(root)
  const service = current.services.find((item) => item.id === id)
  if (!service || !current.host) throw new Error("Service changed")
  await run("docker", ["--host", current.host, "container", "stop", "--timeout", "10", id.split(":").at(-1)!], 15000)
}

export async function startProjectService(directory: unknown, id: unknown) {
  const root = await projectDirectory(directory)
  if (typeof id !== "string" || id.length > 1024) throw new Error("Invalid service")
  const key = `${root}\0${id}`
  if (starting.has(key)) return starting.get(key)
  const pending = (async () => {
    const managed = launched.get(root)
    if (managed?.id === id && managedRunning(managed)) return
    if (id.startsWith("container:")) {
      const current = await projectContainers(root)
      if (!current.host || !current.services.some((service) => service.id === id)) throw new Error("Service changed")
      await run("docker", ["--host", current.host, "container", "start", id.split(":").at(-1)!], 30000)
      return
    }
    const launcher = (await projectLaunchers(root)).find((item) => item.id === id)
    if (!launcher) throw new Error("Service changed")
    if (id === "launch:compose") {
      const current = await projectContainers(root)
      if (!current.host) throw new Error("Local Docker unavailable")
      await execute(
        "docker",
        [
          "--host",
          current.host,
          "compose",
          "--project-directory",
          root,
          "-f",
          join(root, launcher.file!),
          "up",
          "-d",
          "--no-recreate",
        ],
        {
          cwd: root,
          timeout: 120000,
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
          env: { ...process.env, DOCKER_CONTEXT: "", DOCKER_HOST: "" },
        },
      )
      return
    }
    if (managed && managedRunning(managed)) throw new Error("Service already running")
    const child = spawn(launcher.bin, launcher.args, {
      cwd: root,
      detached: process.platform !== "win32",
      stdio: "ignore",
      windowsHide: true,
    })
    const entry = { child, id, command: launcher.command, failed: false, stopped: false }
    launched.set(root, entry)
    child.on("error", () => {
      entry.failed = true
      entry.stopped = true
    })
    child.on("exit", (code) => {
      entry.failed = code !== null && code !== 0
      managedRunning(entry)
    })
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve)
      child.once("error", reject)
    })
    child.unref()
  })().finally(() => starting.delete(key))
  starting.set(key, pending)
  return pending
}

async function projectLaunchers(root: string) {
  const json = async (file: string) => {
    const text = await readFile(join(root, file), "utf8").catch((error) => {
      if (error.code === "ENOENT") return "{}"
      throw error
    })
    return JSON.parse(text) as { scripts?: Record<string, unknown>; require?: Record<string, unknown> }
  }
  const [composer, pkg] = await Promise.all([json("composer.json"), json("package.json")])
  const files = await Promise.all(
    ["compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml", "artisan"].map(async (file) =>
      (await stat(join(root, file)).catch(() => undefined))?.isFile() ? file : undefined,
    ),
  )
  const compose = files.slice(0, 4).find(Boolean)
  const command =
    composer.scripts?.dev && (typeof composer.scripts.dev === "string" || Array.isArray(composer.scripts.dev))
      ? { bin: "composer", args: ["run", "dev"], command: "composer run dev" }
      : files[4] && composer.require?.["laravel/framework"]
        ? { bin: "php", args: ["artisan", "serve", "--host=127.0.0.1"], command: "php artisan serve" }
        : typeof pkg.scripts?.dev === "string"
          ? { bin: "bun", args: ["run", "dev"], command: "bun run dev" }
          : undefined
  return [
    ...(command ? [{ id: "launch:dev", ...command, file: undefined as string | undefined }] : []),
    ...(compose
      ? [{ id: "launch:compose", bin: "docker", args: [], command: "docker compose up -d", file: compose }]
      : []),
  ]
}

function managedRunning(entry: { child: ChildProcess; stopped: boolean }) {
  if (entry.stopped || !entry.child.pid) return false
  if (process.platform === "win32") return entry.child.exitCode === null && entry.child.signalCode === null
  try {
    process.kill(-entry.child.pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      entry.stopped = true
      return false
    }
    throw error
  }
}

async function projectDirectory(directory: unknown) {
  if (typeof directory !== "string" || !isAbsolute(directory) || directory.includes("\0"))
    throw new Error("Invalid project directory")
  const root = await realpath(directory)
  if (parse(root).root === root || !(await stat(root)).isDirectory()) throw new Error("Invalid project directory")
  return root
}

function within(root: string, path: string) {
  const part = relative(root, path)
  return !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`)
}

function lsofRecords(output: string) {
  const records: { pid: number; names: string[] }[] = []
  for (const field of output.split("\0")) {
    const value = field.replace(/^\n/, "")
    if (/^p\d+$/.test(value)) records.push({ pid: Number(value.slice(1)), names: [] })
    if (value.startsWith("n")) records.at(-1)?.names.push(value.slice(1))
  }
  return records
}

async function projectProcesses(root: string): Promise<ProjectService[]> {
  if (process.platform === "win32") throw new Error("Unsupported process discovery")
  const listeners = await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F0pn"]).catch((error) => {
    if (error.code === 1 && !error.stderr) return { stdout: "" }
    throw error
  })
  const records = lsofRecords(listeners.stdout).filter((item) => item.pid !== process.pid && item.pid !== process.ppid)
  if (!records.length) return []
  const pids = records.map((item) => item.pid).join(",")
  const [directories, processes] = await Promise.all([
    run("lsof", ["-a", "-p", pids, "-d", "cwd", "-F0pn"]),
    run("ps", ["-p", pids, "-o", "pid=,uid=,pgid=,lstart=,comm="]),
  ])
  const paths = lsofRecords(directories.stdout)
  return processes.stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d+)\s+(.+)$/.exec(line)
    if (!match || Number(match[2]) !== process.getuid?.()) return []
    const pid = Number(match[1])
    if (!paths.find((entry) => entry.pid === pid)?.names.some((path) => within(root, path))) return []
    if (/ArezaCode\.app|Electron\.app|\/opencode(?:$|\/)/i.test(match[5]!)) return []
    const ports = [
      ...new Set(
        records
          .find((entry) => entry.pid === pid)
          ?.names.flatMap((name) => {
            const port = Number(/:(\d+)$/.exec(name)?.[1])
            return port > 0 && port <= 65535 ? [port] : []
          }),
      ),
    ].sort((a, b) => a - b)
    if (!ports.length) return []
    return [
      {
        id: `process:${pid}:${match[4]}`,
        kind: "process",
        pid,
        group: Number(match[3]),
        name: basename(match[5]!),
        ports,
        urls: [],
      },
    ]
  })
}

type Container = {
  id: string
  name: string
  running: boolean
  directory: string | null
  files: string | null
  mounts: { Type: string; Source: string }[]
  ports: Record<string, { HostIp: string; HostPort: string }[] | null>
}

async function projectContainers(root: string) {
  const endpoint =
    (!process.env.DOCKER_CONTEXT && process.env.DOCKER_HOST) ||
    (await run("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"])).stdout.trim()
  if (!/^(unix|npipe):\/\//.test(endpoint)) return { services: [], status: "remote" as const }
  const ids = (await run("docker", ["--host", endpoint, "ps", "-aq", "--no-trunc"])).stdout
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!ids.length) return { services: [], status: "available" as const, host: endpoint }
  if (!ids.every((id) => /^[a-f0-9]{64}$/.test(id))) throw new Error("Invalid container ID")
  const template =
    '{"id":{{json .Id}},"name":{{json .Name}},"running":{{json .State.Running}},"directory":{{json (index .Config.Labels "com.docker.compose.project.working_dir")}},"files":{{json (index .Config.Labels "com.docker.compose.project.config_files")}},"mounts":{{json .Mounts}},"ports":{{json .NetworkSettings.Ports}}}'
  const inspected = await run("docker", ["--host", endpoint, "container", "inspect", "--format", template, ...ids])
  const services: ProjectService[] = []
  for (const line of inspected.stdout.trim().split("\n")) {
    const item = JSON.parse(line) as Container
    const candidates = item.directory
      ? [item.directory]
      : [
          ...(item.files?.split(",") ?? []),
          ...item.mounts.filter((mount) => mount.Type === "bind").map((mount) => mount.Source),
        ]
    const paths = await Promise.all(candidates.map((path) => realpath(path).catch(() => undefined)))
    if (!paths.some((path) => path && within(root, path))) continue
    const ports = [
      ...new Set(
        Object.entries(item.ports ?? {}).flatMap(([key, bindings]) =>
          key.endsWith("/tcp")
            ? (bindings ?? []).map((binding) => Number(binding.HostPort)).filter((port) => port > 0 && port <= 65535)
            : [],
        ),
      ),
    ].sort((a, b) => a - b)
    services.push({
      id: `container:${endpoint}:${item.id}`,
      kind: "container",
      running: item.running,
      name: item.name.replace(/^\//, ""),
      ports,
      urls: [],
    })
  }
  return { services, status: "available" as const, host: endpoint }
}

async function previewURL(port: number) {
  for (const hostname of ["127.0.0.1", "[::1]"]) {
    for (const protocol of ["http:", "https:"]) {
      const url = `${protocol}//${hostname}:${port}/`
      const available = await new Promise<boolean>((resolve) => {
        const req = (protocol === "http:" ? http : https).request(url, { method: "HEAD", timeout: 600 }, (response) => {
          response.resume()
          resolve(true)
        })
        req.once("timeout", () => req.destroy())
        req.once("error", () => resolve(false))
        req.end()
      })
      if (available) return url.replace(hostname, "localhost")
    }
  }
}
