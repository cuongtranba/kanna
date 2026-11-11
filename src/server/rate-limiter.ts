export type RateDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number }

interface Bucket {
  tokens: number
  refilledAt: number
}

export class WebhookRateLimiter {
  private readonly buckets = new Map<string, Bucket>()

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string): RateDecision {
    const now = this.now()
    const ratePerMs = this.perMinute / 60_000
    const bucket = this.buckets.get(key) ?? { tokens: this.perMinute, refilledAt: now }
    bucket.tokens = Math.min(this.perMinute, bucket.tokens + (now - bucket.refilledAt) * ratePerMs)
    bucket.refilledAt = now
    this.buckets.set(key, bucket)
    if (bucket.tokens < 1) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / ratePerMs / 1000)) }
    }
    bucket.tokens -= 1
    return { allowed: true }
  }

  forget(key: string): void {
    this.buckets.delete(key)
  }
}
