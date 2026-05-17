import type { OAuthTokenEntry } from "../../shared/types"

export type TokenStatusPatch = Partial<Pick<OAuthTokenEntry,
  "status" | "limitedUntil" | "lastUsedAt" | "lastErrorAt" | "lastErrorMessage"
>>

/**
 * Handle returned by `pickEphemeral()`. Callers MUST invoke `release()`
 * when the ephemeral run completes (success or failure) so the
 * underlying token is not pinned by an orphan reservation.
 */
export interface EphemeralLease {
  token: OAuthTokenEntry
  release(): void
}

export class OAuthTokenPool {
  // tokenId -> chatId currently bound to that token. Prevents two
  // concurrent sessions from being assigned the same OAuth token, including
  // the rotation race when both sessions hit a rate-limit at once.
  private readonly reservedBy = new Map<string, string>()

  // Monotonic counter for synthetic ephemeral reservation keys.
  private ephemeralSeq = 0

  constructor(
    private readonly readTokens: () => OAuthTokenEntry[],
    private readonly writeStatus: (id: string, patch: TokenStatusPatch) => void,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Returns true iff the token is eligible at `now` for a caller with the
   * given `reservedFor` identity. Single source of truth for
   * `pickActive` + `hasUsable` so a preflight `hasUsable(chatId)` can't
   * say "yes" while `pickActive(chatId)` returns null (TOCTOU gap closed).
   */
  private isEligible(t: OAuthTokenEntry, now: number, reservedFor: string | undefined): boolean {
    if (t.status === "error" || t.status === "disabled") return false
    const owner = this.reservedBy.get(t.id)
    if (owner !== undefined && owner !== reservedFor) return false
    if (t.status === "limited") {
      if (t.limitedUntil !== null && t.limitedUntil > now) return false
    }
    return true
  }

  pickActive(reservedFor?: string): OAuthTokenEntry | null {
    const now = this.now()
    // Pure read loop: gather eligible candidates without mutating state.
    // The previous implementation called writeStatus() inside the loop to
    // revive elapsed-limited tokens. With a deferred / batched writeStatus
    // the in-flight readTokens() snapshot could still report "limited"
    // for a row we had already revived in the same call. Hoist the
    // revival to a single post-pick step so the read pass is pure.
    const candidates: OAuthTokenEntry[] = []
    for (const t of this.readTokens()) {
      if (!this.isEligible(t, now, reservedFor)) continue
      candidates.push(t)
    }
    if (candidates.length === 0) return null
    candidates.sort((a, b) => (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0))
    const picked = candidates[0]
    if (picked.status === "limited") {
      this.writeStatus(picked.id, { status: "active", limitedUntil: null })
    }
    const result: OAuthTokenEntry = picked.status === "limited"
      ? { ...picked, status: "active", limitedUntil: null }
      : picked
    if (reservedFor !== undefined) {
      // A chat owns at most one token at a time — drop any prior reservation
      // before binding to the new one.
      this.releaseInternal(reservedFor)
      this.reservedBy.set(result.id, reservedFor)
    }
    return result
  }

  /**
   * Picks a token and binds it under a synthetic reservation key so
   * concurrent ephemeral callers (quick-response, slash-command warmup,
   * subagent runs) cannot all be handed the same token at once. The
   * returned `release()` MUST be invoked when the ephemeral work
   * completes. Idempotent.
   */
  pickEphemeral(): EphemeralLease | null {
    this.ephemeralSeq += 1
    const key = `__ephemeral:${this.ephemeralSeq}`
    const token = this.pickActive(key)
    if (!token) return null
    let released = false
    return {
      token,
      release: () => {
        if (released) return
        released = true
        this.releaseInternal(key)
      },
    }
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
    // Drop any reservation — an errored token cannot serve sessions.
    // Mirrors markLimited / markDisabled so the owning chat can immediately
    // re-pick a different token via pickActive() without an explicit release.
    this.reservedBy.delete(id)
  }

  markDisabled(id: string): void {
    this.writeStatus(id, { status: "disabled" })
    // Drop any reservation — a disabled token cannot serve sessions.
    this.reservedBy.delete(id)
  }

  markEnabled(id: string): void {
    this.writeStatus(id, { status: "active" })
  }

  /**
   * Read-only: does the pool contain any token entries at all, regardless
   * of status? Distinguishes "user opted into pool auth but all tokens are
   * unusable right now" (refuse spawn — avoid silent keychain fallback that
   * returns 401 against an expired login) from "user has not configured
   * pool, allow CLI keychain fallback".
   */
  hasAnyToken(): boolean {
    return this.readTokens().length > 0
  }

  /**
   * Read-only probe: does the pool have at least one token currently usable
   * by a caller with the given `reservedFor` identity (or by an unreserved
   * caller when omitted)? Unlike `pickActive`, does NOT mutate `status` for
   * elapsed-limited tokens. Matches `pickActive`'s eligibility filter
   * exactly so a preflight `hasUsable(chatId)` cannot say "yes" while the
   * subsequent `pickActive(chatId)` returns null (TOCTOU gap closed).
   */
  hasUsable(reservedFor?: string): boolean {
    const now = this.now()
    for (const t of this.readTokens()) {
      if (this.isEligible(t, now, reservedFor)) return true
    }
    return false
  }

  allLimited(): boolean {
    // Only considers non-disabled, non-error tokens — disabled accounts are
    // intentionally excluded from the pool and do not affect rate-limit state.
    const eligible = this.readTokens().filter((t) => t.status !== "disabled" && t.status !== "error")
    if (eligible.length === 0) return false
    const now = this.now()
    return eligible.every((t) => t.status === "limited" && t.limitedUntil !== null && t.limitedUntil > now)
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
