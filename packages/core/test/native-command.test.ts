import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { nativeCommand } from "../src/util/native-command"

async function waitFor(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 4000
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error("Process condition did not settle")
    await Bun.sleep(20)
  }
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe("nativeCommand", () => {
  test("returns normal stdout and rejects failed commands", async () => {
    expect(await nativeCommand(process.execPath, ["-e", 'process.stdout.write("ready")'])).toBe("ready")
    await expect(nativeCommand(process.execPath, ["-e", "process.exit(2)"])).rejects.toThrow("failed (2)")
  })

  test("does not launch a command with an already cancelled signal", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "native-cancel-"))
    const marker = path.join(directory, "started")
    try {
      await expect(nativeCommand(process.execPath, ["-e", `await Bun.write(${JSON.stringify(marker)}, "started")`], {
        signal: AbortSignal.abort(),
      })).rejects.toThrow("cancelled")
      expect(await Bun.file(marker).exists()).toBe(false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test.skipIf(process.platform === "win32").each(["resistant", "exiting", "timeout"])(
    "reaps a %s parent and resistant descendant before rejecting",
    async (mode) => {
      const directory = await mkdtemp(path.join(tmpdir(), "native-tree-"))
      const marker = path.join(directory, "pids.json")
      const controller = new AbortController()
      const script = `
        import { spawn } from "node:child_process"
        import { once } from "node:events"
        process.on("SIGTERM", () => { ${mode === "exiting" ? "process.exit(0)" : ""} })
        const child = spawn(process.execPath, ["-e", 'process.on("SIGTERM", () => {}); process.stdout.write("ready"); setInterval(() => {}, 1000)'], { stdio: ["ignore", "pipe", "ignore"] })
        await once(child.stdout, "data")
        await Bun.write(${JSON.stringify(marker)}, JSON.stringify([process.pid, child.pid]))
        setInterval(() => {}, 1000)
      `
      const result = nativeCommand(process.execPath, ["-e", script], {
        signal: controller.signal,
        timeout: mode === "timeout" ? 1500 : 10_000,
      }).then(() => undefined, (error: unknown) => error)
      try {
        await waitFor(() => Bun.file(marker).exists())
        const pids: number[] = await Bun.file(marker).json()
        if (mode !== "timeout") controller.abort()
        expect(await result).toBeInstanceOf(Error)
        await waitFor(() => pids.every((pid) => !alive(pid)))
      } finally {
        controller.abort()
        await result
        await rm(directory, { recursive: true, force: true })
      }
    },
    10_000,
  )
})
