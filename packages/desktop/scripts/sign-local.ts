import { lstatSync } from "node:fs"
import { resolve } from "node:path"

const app = process.argv[2] && resolve(process.argv[2])
if (
  process.platform !== "darwin" ||
  !app?.endsWith(".app") ||
  !(await Bun.file(`${app}/Contents/Info.plist`).exists())
) {
  throw new Error("Usage: bun run sign:local /absolute/path/ArezaCode.app (macOS only)")
}

const paths: string[] = []
for await (const relative of new Bun.Glob("**/*").scan({
  cwd: app,
  onlyFiles: false,
  followSymlinks: false,
  dot: true,
})) {
  const path = `${app}/${relative}`
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) continue
  if (stat.isDirectory()) {
    if (/\.(app|framework)$/.test(path)) paths.push(path)
    continue
  }
  if (!(stat.mode & 0o111) && !/\.(dylib|node)$/.test(path)) continue
  const bytes = new Uint8Array(await Bun.file(path).slice(0, 4).arrayBuffer())
  const magic = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  if (["cffaedfe", "cefaedfe", "feedfacf", "feedface", "cafebabe", "bebafeca", "cafebabf", "bfbafeca"].includes(magic))
    paths.push(path)
}

for (const path of [...paths.sort((a, b) => b.split("/").length - a.split("/").length), app]) {
  const result = Bun.spawnSync(
    [
      "/usr/bin/codesign",
      "--force",
      "--sign",
      "ArezaCode Local Development",
      "--preserve-metadata=identifier,entitlements,flags,runtime",
      "--timestamp=none",
      path,
    ],
    { stdout: "pipe", stderr: "pipe" },
  )
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

const verified = Bun.spawnSync(["/usr/bin/codesign", "--verify", "--deep", "--strict", app], {
  stdout: "pipe",
  stderr: "pipe",
})
if (verified.exitCode !== 0) throw new Error(verified.stderr.toString())
console.log(`Signed and verified ${paths.length + 1} code objects with the stable local identity.`)
