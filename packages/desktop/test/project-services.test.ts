import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listProjectServices, stopProjectService } from "../src/main/project-services"

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
    } finally {
      if (/^[a-f0-9]{64}$/.test(id))
        await Bun.spawn(["docker", "rm", "-f", id], { stdout: "ignore", stderr: "ignore" }).exited
      await rm(project, { recursive: true, force: true })
    }
  },
  30000,
)
