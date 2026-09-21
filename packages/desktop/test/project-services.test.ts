import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listProjectServices, startProjectService, stopProjectService } from "../src/main/project-services"

test("detects project commands and owns the whole dev server process group", async () => {
  const root = await mkdtemp(join(tmpdir(), "areza-dev-services-"))
  const sibling = await mkdtemp(join(tmpdir(), "areza-dev-other-"))
  try {
    await Bun.write(join(root, "package.json"), JSON.stringify({ scripts: { dev: "bun dev.ts" } }))
    await Bun.write(
      join(root, "dev.ts"),
      `
      Bun.spawn([process.execPath, "child.ts"], { stdout: "ignore", stderr: "ignore" })
      setInterval(() => {}, 1000)
    `,
    )
    await Bun.write(
      join(root, "child.ts"),
      `
      const server = Bun.serve({ port: 0, fetch: () => new Response("Ready") })
      await Bun.write("ready.json", JSON.stringify({ pid: process.pid, port: server.port }))
    `,
    )
    expect((await listProjectServices(root)).launchers).toEqual([{ id: "launch:dev", command: "bun run dev" }])
    await expect(startProjectService(root, "bun run arbitrary")).rejects.toThrow("Service changed")
    await Promise.all([startProjectService(root, "launch:dev"), startProjectService(root, "launch:dev")])
    for (let attempt = 0; attempt < 50 && !(await Bun.file(join(root, "ready.json")).exists()); attempt++)
      await Bun.sleep(50)
    const ready = await Bun.file(join(root, "ready.json")).json()
    expect((await fetch(`http://localhost:${ready.port}`)).status).toBe(200)
    const services = (await listProjectServices(root)).services
    const managed = services.find((service) => service.id === "launch:dev")!
    expect(managed.running).toBe(true)
    expect(managed.ports).toContain(ready.port)
    expect(services.some((service) => service.pid === ready.pid)).toBe(false)
    await startProjectService(root, "launch:dev")
    expect((await listProjectServices(root)).services.find((service) => service.id === "launch:dev")?.pid).toBe(
      managed.pid,
    )
    await expect(stopProjectService(sibling, "launch:dev")).rejects.toThrow("Service changed")
    await stopProjectService(root, "launch:dev")
    expect((await listProjectServices(root)).services.find((service) => service.id === "launch:dev")?.running).toBe(
      false,
    )
    expect(() => process.kill(ready.pid, 0)).toThrow()
    await Bun.write(join(root, "dev.ts"), "process.exit(1)")
    await startProjectService(root, "launch:dev")
    for (let attempt = 0; attempt < 50; attempt++) {
      if ((await listProjectServices(root)).services.find((service) => service.id === "launch:dev")?.failed) break
      await Bun.sleep(50)
    }
    expect((await listProjectServices(root)).services.find((service) => service.id === "launch:dev")?.failed).toBe(true)
    await Bun.write(
      join(root, "composer.json"),
      JSON.stringify({ require: { "laravel/framework": "^13.0" }, scripts: { dev: ["@php artisan serve"] } }),
    )
    await Bun.write(join(root, "artisan"), "")
    await Bun.write(join(root, "compose.yaml"), "services: {}")
    const detected = await listProjectServices(root)
    expect(detected.launchers?.find((launcher) => launcher.id === "launch:compose")?.command).toBe(
      "docker compose up -d",
    )
    await Bun.write(join(sibling, "composer.json"), JSON.stringify({ require: { "laravel/framework": "^13.0" } }))
    await Bun.write(join(sibling, "artisan"), "")
    expect(
      (await listProjectServices(sibling)).launchers?.find((launcher) => launcher.id === "launch:dev")?.command,
    ).toBe("php artisan serve")
    await Bun.write(join(sibling, "composer.json"), JSON.stringify({ scripts: { dev: ["@php artisan serve"] } }))
    expect(
      (await listProjectServices(sibling)).launchers?.find((launcher) => launcher.id === "launch:dev")?.command,
    ).toBe("composer run dev")
  } finally {
    await stopProjectService(root, "launch:dev").catch(() => {})
    await Promise.all([rm(root, { recursive: true, force: true }), rm(sibling, { recursive: true, force: true })])
  }
}, 20000)

test("discovers and stops only the current project's listening processes", async () => {
  const root = await mkdtemp(join(tmpdir(), "areza-services-"))
  const project = join(root, "project")
  const sibling = join(root, "project-other")
  await Promise.all([mkdir(project), mkdir(sibling)])
  const children = [project, sibling].map((cwd) =>
    Bun.spawn(
      [
        process.execPath,
        "-e",
        'const server = Bun.serve({port:0,fetch:()=>new Response("Preview")}); console.log(server.port)',
      ],
      { cwd, stdout: "pipe", stderr: "pipe" },
    ),
  )
  try {
    const ports = await Promise.all(
      children.map(async (child) =>
        Number(new TextDecoder().decode((await child.stdout.getReader().read()).value).trim()),
      ),
    )
    const result = await listProjectServices(project)
    const service = result.services.find((item) => item.pid === children[0]!.pid)!
    expect(service.ports).toEqual([ports[0]!])
    expect(service.urls).toEqual([`http://localhost:${ports[0]}/`])
    expect(result.services.some((item) => item.pid === children[1]!.pid)).toBe(false)
    await expect(stopProjectService(sibling, service.id)).rejects.toThrow("Service changed")
    await expect(stopProjectService(project, service.id + "stale")).rejects.toThrow("Service changed")
    expect((await fetch(`http://localhost:${ports[0]}`)).status).toBe(200)
    await stopProjectService(project, service.id)
    await children[0]!.exited
    expect((await fetch(`http://localhost:${ports[1]}`)).status).toBe(200)
    await expect(listProjectServices("/")).rejects.toThrow("Invalid project directory")
  } finally {
    children.forEach((child) => child.kill())
    await Promise.all(children.map((child) => child.exited))
    await rm(root, { recursive: true, force: true })
  }
}, 20000)

test.skipIf(process.env.AREZA_TEST_DOCKER !== "1")(
  "stops a disposable project's Docker container",
  async () => {
    const project = await mkdtemp(join(tmpdir(), "areza-docker-services-"))
    const run = Bun.spawn(
      [
        "docker",
        "run",
        "-d",
        "--label",
        `com.docker.compose.project.working_dir=${project}`,
        "alpine:3",
        "sleep",
        "300",
      ],
      { stdout: "pipe", stderr: "pipe" },
    )
    const id = (await new Response(run.stdout).text()).trim()
    try {
      expect(await run.exited).toBe(0)
      const result = await listProjectServices(project)
      const service = result.services.find((item) => item.kind === "container" && item.id.endsWith(id))!
      expect(service).toBeDefined()
      await expect(stopProjectService(join(project, "..", "does-not-exist"), service.id)).rejects.toThrow()
      await stopProjectService(project, service.id)
      const inspect = Bun.spawn(["docker", "inspect", "--format", "{{.State.Running}}", id], { stdout: "pipe" })
      expect((await new Response(inspect.stdout).text()).trim()).toBe("false")
      expect(await inspect.exited).toBe(0)
      expect((await listProjectServices(project)).services.find((item) => item.id === service.id)?.running).toBe(false)
      await startProjectService(project, service.id)
      expect((await listProjectServices(project)).services.find((item) => item.id === service.id)?.running).toBe(true)
      await Bun.write(
        join(project, "compose.yaml"),
        'services:\n  worker:\n    image: alpine:3\n    command: ["sleep", "300"]\n',
      )
      await startProjectService(project, "launch:compose")
      const composed = (await listProjectServices(project)).services.find((item) => item.name.endsWith("-worker-1"))!
      expect(composed?.running).toBe(true)
      await stopProjectService(project, composed.id)
      expect((await listProjectServices(project)).services.find((item) => item.id === composed.id)?.running).toBe(false)
    } finally {
      if (await Bun.file(join(project, "compose.yaml")).exists())
        await Bun.spawn(["docker", "compose", "--project-directory", project, "down"], {
          stdout: "ignore",
          stderr: "ignore",
        }).exited
      if (/^[a-f0-9]{64}$/.test(id))
        await Bun.spawn(["docker", "rm", "-f", id], { stdout: "ignore", stderr: "ignore" }).exited
      await rm(project, { recursive: true, force: true })
    }
  },
  30000,
)
