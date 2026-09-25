import { nativeT } from "../native-translations"
import { pollHealth } from "../health-poll"

export function wslServerIdsToStartOnInitialize(servers: { id: string }[]) {
  return servers.map((server) => server.id)
}

export function expectOpencodeVersion(installed: string | null, expected: string, distro = "Debian") {
  if (installed === expected) return
  throw new Error(
    nativeT("desktop.wsl.error.updateVersion", {
      distro,
      installed: installed ?? nativeT("desktop.wsl.error.noVersion"),
      expected,
    }),
  )
}

export const pendingRestartAfterWslInstall = (runtime: { available: boolean }) => !runtime.available

export async function pollWslHealth(check: () => Promise<boolean>, signal: AbortSignal, interval = 100) {
  return pollHealth(() => check(), signal, interval)
}
