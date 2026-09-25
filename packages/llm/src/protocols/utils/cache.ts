// Shared helpers for provider cache-marker lowering. Anthropic and Bedrock
// both enforce a 4-breakpoint cap per request and accept the same `5m`/`1h`
// TTL buckets, so the counter and TTL mapping live here.

export interface Breakpoints {
  remaining: number
  dropped: number
}

export const BREAKPOINT_CAP = 4

export const newBreakpoints = (cap = BREAKPOINT_CAP): Breakpoints => ({ remaining: cap, dropped: 0 })

export const cacheControl = (ttlSeconds: number | undefined) => ({
  type: "ephemeral" as const,
  ...(ttlBucket(ttlSeconds) === "1h" ? { ttl: "1h" as const } : {}),
})

// Returns `"1h"` for any `ttlSeconds >= 3600`, otherwise `undefined` (the
// provider default 5m). Anthropic & Bedrock both treat anything shorter than
// an hour as 5m.
export const ttlBucket = (ttlSeconds: number | undefined): "1h" | undefined =>
  ttlSeconds !== undefined && ttlSeconds >= 3600 ? "1h" : undefined
