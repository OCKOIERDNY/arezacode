import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

for (const fixture of ["headroom-cache", "jev-context-cache", "jev-flow", ...(process.env.AREZACODE_TEST_HEADROOM_PYTHON ? ["headroom-real"] : [])]) {
  test(`${fixture}: isolated speed and quality regression checks`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "areza-speed-cache-"))
    try {
      const child = Bun.spawn([process.execPath, path.join(import.meta.dir, `fixtures/${fixture}.ts`)], {
        env: {
          ...process.env,
          XDG_CONFIG_HOME: directory,
          XDG_DATA_HOME: directory,
          XDG_CACHE_HOME: directory,
          XDG_STATE_HOME: directory,
          TMPDIR: directory,
          OPENCODE_TEST_HOME: directory,
          OPENROUTER_API_KEY: "",
          OPENCODE_AUTH_CONTENT: "",
          AREZACODE_HEADROOM: "1",
        },
        stdout: "pipe",
        stderr: "pipe",
      })
      const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      expect(code, output + error).toBe(0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }, 30_000)
}
