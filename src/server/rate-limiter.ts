export type RateDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number }

export interface RateWindow {
  limit: number
  windowMs: number
}

interface Bucket {
  tokens: number
  refilledAt: number
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket[]>()

  constructor(
    private readonly windows: readonly RateWindow[],
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string): RateDecision {
    const now = this.now()
    const buckets = this.buckets.get(key) ?? this.windows.map((window) => ({ tokens: window.limit, refilledAt: now }))
    this.buckets.set(key, buckets)
    let retryAfterSeconds = 0
    this.windows.forEach((window, index) => {
      const bucket = buckets[index]
      bucket.tokens = Math.min(window.limit, bucket.tokens + (now - bucket.refilledAt) * (window.limit / window.windowMs))
      bucket.refilledAt = now
      if (bucket.tokens < 1) {
        const wait = Math.ceil((1 - bucket.tokens) / (window.limit / window.windowMs) / 1000)
        retryAfterSeconds = Math.max(retryAfterSeconds, wait, 1)
      }
    })
    if (retryAfterSeconds > 0) return { allowed: false, retryAfterSeconds }
    for (const bucket of buckets) bucket.tokens -= 1
    return { allowed: true }
  }

  forget(key: string): void {
    this.buckets.delete(key)
  }
}
