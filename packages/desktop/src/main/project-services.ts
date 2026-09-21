import { execFile } from "node:child_process"
import { realpath, stat } from "node:fs/promises"
import http from "node:http"
import https from "node:https"
import { basename, isAbsolute, parse, relative, sep } from "node:path"
import { promisify } from "node:util"
import type { ProjectService, ProjectServicesState } from "@opencode-ai/app/project-services"

const execute = promisify(execFile)
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
  const services = [
    ...(processes.status === "fulfilled" ? processes.value : []),
    ...(docker.status === "fulfilled" ? docker.value.services : []),
  ]
  await Promise.all(
    services.map(async (service) => {
      service.urls = (await Promise.all(service.ports.map(previewURL))).filter((url): url is string => !!url)
    }),
  )
  return {
    services,
    processes: processes.status === "fulfilled" ? "available" : "unavailable",
    docker: docker.status === "fulfilled" ? docker.value.status : "unavailable",
  }
}

export async function stopProjectService(directory: unknown, id: unknown) {
  const root = await projectDirectory(directory)
  if (typeof id !== "string" || id.length > 1024) throw new Error("Invalid service")
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
    run("ps", ["-p", pids, "-o", "pid=,uid=,lstart=,comm="]),
  ])
  const paths = lsofRecords(directories.stdout)
  return processes.stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d+)\s+(.+)$/.exec(line)
    if (!match || Number(match[2]) !== process.getuid?.()) return []
    const pid = Number(match[1])
    if (!paths.find((entry) => entry.pid === pid)?.names.some((path) => within(root, path))) return []
    if (/ArezaCode\.app|Electron\.app|\/opencode(?:$|\/)/i.test(match[4]!)) return []
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
    return [{ id: `process:${pid}:${match[3]}`, kind: "process", pid, name: basename(match[4]!), ports, urls: [] }]
  })
}

type Container = {
  id: string
  name: string
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
  const ids = (await run("docker", ["--host", endpoint, "ps", "-q", "--no-trunc"])).stdout
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!ids.length) return { services: [], status: "available" as const, host: endpoint }
  if (!ids.every((id) => /^[a-f0-9]{64}$/.test(id))) throw new Error("Invalid container ID")
  const template =
    '{"id":{{json .Id}},"name":{{json .Name}},"directory":{{json (index .Config.Labels "com.docker.compose.project.working_dir")}},"files":{{json (index .Config.Labels "com.docker.compose.project.config_files")}},"mounts":{{json .Mounts}},"ports":{{json .NetworkSettings.Ports}}}'
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
