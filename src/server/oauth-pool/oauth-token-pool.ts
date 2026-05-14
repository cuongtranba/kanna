import type { OAuthTokenEntry } from "../../shared/types"

export type TokenStatusPatch = Partial<Pick<OAuthTokenEntry,
  "status" | "limitedUntil" | "lastUsedAt" | "lastErrorAt" | "lastErrorMessage"
>>

export class OAuthTokenPool {
  // tokenId -> chatId currently bound to that token. Prevents two
  // concurrent sessions from being assigned the same OAuth token, including
  // the rotation race when both sessions hit a rate-limit at once.
  private readonly reservedBy = new Map<string, string>()

  constructor(
    private readonly readTokens: () => OAuthTokenEntry[],
    private readonly writeStatus: (id: string, patch: TokenStatusPatch) => void,
    private readonly now: () => number = Date.now,
  ) {}

  pickActive(reservedFor?: string): OAuthTokenEntry | null {
    const now = this.now()
    const candidates: OAuthTokenEntry[] = []
    for (const t of this.readTokens()) {
      if (t.status === "error") continue
      const owner = this.reservedBy.get(t.id)
      if (owner !== undefined && owner !== reservedFor) continue
      if (t.status === "limited") {
        if (t.limitedUntil !== null && t.limitedUntil > now) continue
        this.writeStatus(t.id, { status: "active", limitedUntil: null })
        candidates.push({ ...t, status: "active", limitedUntil: null })
        continue
      }
      candidates.push(t)
    }
    if (candidates.length === 0) return null
    candidates.sort((a, b) => (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0))
    const picked = candidates[0]
    if (reservedFor !== undefined) {
      // A chat owns at most one token at a time — drop any prior reservation
      // before binding to the new one.
      this.releaseInternal(reservedFor)
      this.reservedBy.set(picked.id, reservedFor)
    }
    return picked
  }

  release(reservedFor: string): void {
    this.releaseInternal(reservedFor)
  }

  private releaseInternal(reservedFor: string): void {
    for (const [tokenId, owner] of this.reservedBy) {
      if (owner === reservedFor) this.reservedBy.delete(tokenId)
    }
  }

  markLimited(id: string, resetAt: number): void {
    this.writeStatus(id, { status: "limited", limitedUntil: resetAt })
    // A limited token cannot serve any session — drop any reservation so the
    // owning chat can re-pick a different token without an explicit release.
    this.reservedBy.delete(id)
  }

  markUsed(id: string): void {
    this.writeStatus(id, { lastUsedAt: this.now() })
  }

  markError(id: string, message: string): void {
    this.writeStatus(id, { status: "error", lastErrorAt: this.now(), lastErrorMessage: message })
  }

  /**
   * Read-only probe: does the pool have at least one token currently usable
   * (active, or limited-but-elapsed)? Unlike pickActive(), does NOT mutate
   * `status` for elapsed-limited tokens. Use for preflight checks.
   */
  hasUsable(): boolean {
    const now = this.now()
    for (const t of this.readTokens()) {
      if (t.status === "error") continue
      if (t.status === "limited") {
        if (t.limitedUntil !== null && t.limitedUntil > now) continue
      }
      return true
    }
    return false
  }

  allLimited(): boolean {
    const tokens = this.readTokens()
    if (tokens.length === 0) return false
    const now = this.now()
    return tokens.every((t) => t.status === "limited" && t.limitedUntil !== null && t.limitedUntil > now)
  }

  earliestUnlimit(): number | null {
    const now = this.now()
    let earliest: number | null = null
    for (const t of this.readTokens()) {
      if (t.status !== "limited") continue
      if (t.limitedUntil === null || t.limitedUntil <= now) continue
      if (earliest === null || t.limitedUntil < earliest) earliest = t.limitedUntil
    }
    return earliest
  }
}
