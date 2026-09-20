import { execFile } from "node:child_process"
import { homedir } from "node:os"
import path from "node:path"
import which from "which"

export async function nativeBinary(name: string) {
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
    const child = execFile(
      command,
      args,
      {
        cwd: options.cwd,
        env: options.env ?? process.env,
        timeout: options.timeout ?? 30_000,
        signal: options.signal,
        maxBuffer: 16 * 1024 * 1024,
        encoding: "utf8",
        windowsHide: true,
      },
      (error, stdout) => {
        if (error)
          return reject(
            new Error(
              `${path.basename(command)} failed (${error.code ?? "interrupted"}); no successful result was recorded.`,
            ),
          )
        resolve(stdout)
      },
    )
    child.stdin?.on("error", () => {})
    child.stdin?.end(options.input)
  })
}
