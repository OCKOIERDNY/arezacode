export async function pollHealth(check: (signal: AbortSignal) => Promise<boolean>, signal: AbortSignal, interval = 100) {
  while (!signal.aborted) {
    if (await check(signal)) return
    await abortableDelay(interval, signal)
  }
}

function abortableDelay(duration: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timeout)
      signal.removeEventListener("abort", done)
      resolve()
    }
    const timeout = setTimeout(done, duration)
    signal.addEventListener("abort", done, { once: true })
  })
}
