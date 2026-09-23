export function getTurnDurationMs(
  created: number,
  assistants: readonly { time: { completed?: number } }[],
  now?: number,
) {
  const end = now ?? assistants.reduce<number | undefined>((latest, message) => {
    const completed = message.time.completed
    if (completed === undefined || !Number.isFinite(completed)) return latest
    return latest === undefined ? completed : Math.max(latest, completed)
  }, undefined)
  if (end === undefined || !Number.isFinite(end) || !Number.isFinite(created)) return
  return Math.max(0, end - created)
}
