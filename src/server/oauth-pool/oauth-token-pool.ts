import type { OAuthTokenEntry } from "../../shared/types"

export type TokenStatusPatch = Partial<Pick<OAuthTokenEntry,
  "status" | "limitedUntil" | "lastUsedAt" | "lastErrorAt" | "lastErrorMessage"
>>

export class OAuthTokenPool {
  constructor(
    private readonly readTokens: () => OAuthTokenEntry[],
    private readonly writeStatus: (id: string, patch: TokenStatusPatch) => void,
    private readonly now: () => number = Date.now,
  ) {}

  pickActive(): OAuthTokenEntry | null {
    const now = this.now()
    const candidates: OAuthTokenEntry[] = []
    for (const t of this.readTokens()) {
      if (t.status === "limited" && t.limitedUntil !== null && t.limitedUntil > now) continue
      if (t.status === "limited" && (t.limitedUntil === null || t.limitedUntil <= now)) {
        this.writeStatus(t.id, { status: "active", limitedUntil: null })
        candidates.push({ ...t, status: "active", limitedUntil: null })
        continue
      }
      candidates.push(t)
    }
    if (candidates.length === 0) return null
    candidates.sort((a, b) => (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0))
    return candidates[0]
  }

  markLimited(id: string, resetAt: number): void {
    this.writeStatus(id, { status: "limited", limitedUntil: resetAt })
  }

  markUsed(id: string): void {
    this.writeStatus(id, { lastUsedAt: this.now() })
  }

  markError(id: string, message: string): void {
    this.writeStatus(id, { status: "error", lastErrorAt: this.now(), lastErrorMessage: message })
  }

  allLimited(): boolean {
    const tokens = this.readTokens()
    if (tokens.length === 0) return false
    const now = this.now()
    return tokens.every((t) => t.status === "limited" && t.limitedUntil !== null && t.limitedUntil > now)
  }
}
