import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("embedded browser is isolated, navigable and disposed with its tab", async () => {
  const directory = await mkdtemp(join(tmpdir(), "areza-browser-test-"))
  try {
    const build = await Bun.build({
      entrypoints: [join(import.meta.dir, "browser-view.fixture.ts")],
      outdir: directory,
      target: "node",
      format: "esm",
      external: ["electron"],
    })
    expect(build.success).toBe(true)
    const electron = (await import("electron")).default
    const child = Bun.spawn([electron, build.outputs[0].path], {
      env: { ...process.env, BROWSER_TEST_DIR: directory },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ exit, output: exit === 0 ? stdout.trim() : stderr }).toEqual({
      exit: 0,
      output: "Browser isolation, navigation, visibility and cleanup passed",
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
