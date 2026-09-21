import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const directory = await mkdtemp(join(tmpdir(), "areza-browser-test-"))
const build = await Bun.build({
  entrypoints: [join(import.meta.dir, "../src/main/browser-control.integration.ts")],
  outdir: directory,
  naming: "[name].mjs",
  target: "node",
  format: "esm",
  external: ["electron"],
})
if (!build.success) throw new Error(build.logs.join("\n"))
const electron = join(import.meta.dir, "../node_modules/electron")
const executable = join(electron, "dist", (await Bun.file(join(electron, "path.txt")).text()).trim())
const child = Bun.spawn([executable, build.outputs[0]!.path], {
  env: {
    ...process.env,
    XDG_CACHE_HOME: directory,
    AREZACODE_BROWSER_TEST_DATA: directory,
    ELECTRON_RUN_AS_NODE: undefined,
  },
  stdout: "inherit",
  stderr: "inherit",
})
const timeout = setTimeout(() => child.kill(), 60000)
const exit = await child.exited
clearTimeout(timeout)
await rm(directory, { recursive: true, force: true })
process.exit(exit)
