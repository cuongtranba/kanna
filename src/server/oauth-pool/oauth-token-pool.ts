import type { OAuthTokenEntry } from "../../shared/types"

export type TokenStatusPatch = Partial<Pick<OAuthTokenEntry,
  "status" | "limitedUntil" | "lastUsedAt" | "lastErrorAt" | "lastErrorMessage"
>>

export type TokenUnavailability =
  | { tokenId: string; label: string; reason: "available" }
  | { tokenId: string; label: string; reason: "limited"; until: number }
  | { tokenId: string; label: string; reason: "reserved"; byChatIds: string[]; ownedBySelf: boolean }
  | { tokenId: string; label: string; reason: "error"; message: string | null }
  | { tokenId: string; label: string; reason: "disabled" }

/**
 * Handle returned by `pickEphemeral()`. Callers MUST invoke `release()`
 * when the ephemeral run completes (success or failure) so the
 * underlying token is not pinned by an orphan reservation.
 */
export interface EphemeralLease {
  token: OAuthTokenEntry
  release(): void
}

const ABSOLUTE_MIN_CAP = 1
const ABSOLUTE_MAX_CAP = 5

export class OAuthTokenPool {
  // tokenId -> set of chat ids currently bound to that token. A token may
  // be bound by up to `tokenCap(token)` chats concurrently (see ADR
  // adr-20260522-oauth-token-share-cap). Sharing is opt-in per token via
  // OAuthTokenEntry.maxConcurrent; pool-wide default comes from
  // ClaudeAuthSettings.concurrencyDefault via the readGlobalCap closure.
  private readonly reservedBy = new Map<string, Set<string>>()

  // Monotonic counter for synthetic ephemeral reservation keys.
  private ephemeralSeq = 0

  constructor(
    private readonly readTokens: () => OAuthTokenEntry[],
    private readonly writeStatus: (id: string, patch: TokenStatusPatch) => void,
    private readonly now: () => number = Date.now,
    private readonly readGlobalCap: () => number = () => ABSOLUTE_MIN_CAP,
  ) {}

  private tokenCap(t: OAuthTokenEntry): number {
    const raw = typeof t.maxConcurrent === "number" && Number.isFinite(t.maxConcurrent)
      ? t.maxConcurrent
      : this.readGlobalCap()
    if (!Number.isFinite(raw)) return ABSOLUTE_MIN_CAP
    const rounded = Math.round(raw)
    if (rounded < ABSOLUTE_MIN_CAP) return ABSOLUTE_MIN_CAP
    if (rounded > ABSOLUTE_MAX_CAP) return ABSOLUTE_MAX_CAP
    return rounded
  }

  private getOwners(tokenId: string): Set<string> {
    return this.reservedBy.get(tokenId) ?? new Set()
  }

  /**
   * Returns true iff the token is eligible at `now` for a caller with the
   * given `reservedFor` identity. Single source of truth for
   * `pickActive` + `hasUsable` so a preflight `hasUsable(chatId)` can't
   * say "yes" while `pickActive(chatId)` returns null (TOCTOU gap closed).
   */
  private isEligible(t: OAuthTokenEntry, now: number, reservedFor: string | undefined): boolean {
    if (t.status === "error" || t.status === "disabled") return false
    const owners = this.getOwners(t.id)
    const reentrant = reservedFor !== undefined && owners.has(reservedFor)
    if (!reentrant && owners.size >= this.tokenCap(t)) return false
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
    // Re-entrant call: if the caller already owns one of the eligible
    // tokens, return that one. Avoids churn on repeated pickActive(chatId)
    // calls from the same chat that today expect a stable answer.
    if (reservedFor !== undefined) {
      const owned = candidates.find((t) => this.getOwners(t.id).has(reservedFor))
      if (owned) {
        if (owned.status === "limited") {
          this.writeStatus(owned.id, { status: "active", limitedUntil: null })
          return { ...owned, status: "active", limitedUntil: null }
        }
        return owned
      }
    }
    // Spread load before stacking: prefer the token with the smallest
    // current owner count, then break ties by least-recently-used.
    candidates.sort((a, b) => {
      const oa = this.getOwners(a.id).size
      const ob = this.getOwners(b.id).size
      if (oa !== ob) return oa - ob
      return (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0)
    })
    const picked = candidates[0]
    if (picked.status === "limited") {
      this.writeStatus(picked.id, { status: "active", limitedUntil: null })
    }
    const result: OAuthTokenEntry = picked.status === "limited"
      ? { ...picked, status: "active", limitedUntil: null }
      : picked
    if (reservedFor !== undefined) {
      // A chat owns at most one token at a time across the pool — drop the
      // caller from any other token's owner set before binding to the new
      // one, but DO NOT clobber other owners of the picked token.
      this.removeOwnerExcept(reservedFor, result.id)
      const owners = this.reservedBy.get(result.id) ?? new Set<string>()
      owners.add(reservedFor)
      this.reservedBy.set(result.id, owners)
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
    for (const [tokenId, owners] of this.reservedBy) {
      if (owners.delete(reservedFor) && owners.size === 0) {
        this.reservedBy.delete(tokenId)
      }
    }
  }

  private removeOwnerExcept(reservedFor: string, exceptTokenId: string): void {
    for (const [tokenId, owners] of this.reservedBy) {
      if (tokenId === exceptTokenId) continue
      if (owners.delete(reservedFor) && owners.size === 0) {
        this.reservedBy.delete(tokenId)
      }
    }
  }

  markLimited(id: string, resetAt: number): void {
    this.writeStatus(id, { status: "limited", limitedUntil: resetAt })
    // Limited token cannot serve any session. The rotation layer in
    // agent.ts must call takeStaleOwners(id) BEFORE invoking markLimited
    // so it learns which chats need a coordinated re-pick. We then clear
    // the local reservation set so subsequent pickActive() does not see
    // stale owners for the limited token.
    this.reservedBy.delete(id)
  }

  markUsed(id: string): void {
    this.writeStatus(id, { lastUsedAt: this.now() })
  }

  markError(id: string, message: string): void {
    this.writeStatus(id, { status: "error", lastErrorAt: this.now(), lastErrorMessage: message })
    // Drop reservations — an errored token cannot serve sessions. The
    // rotation layer must call takeStaleOwners(id) BEFORE markError for
    // coordinated re-pick.
    this.reservedBy.delete(id)
  }

  markDisabled(id: string): void {
    this.writeStatus(id, { status: "disabled" })
    this.reservedBy.delete(id)
  }

  markEnabled(id: string): void {
    this.writeStatus(id, { status: "active" })
  }

  /**
   * Returns and clears the owner set associated with a token. The
   * rotation layer in agent.ts calls this immediately BEFORE markLimited
   * / markError so it learns which chats were sharing the token and can
   * drive a coordinated, deduped, staggered re-pick for each. Mirrors
   * release(chatId) lifetime semantics: a removed owner is no longer
   * counted against the token's cap.
   */
  takeStaleOwners(id: string): string[] {
    const owners = this.reservedBy.get(id)
    if (!owners || owners.size === 0) return []
    const out = [...owners]
    this.reservedBy.delete(id)
    return out
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

  /**
   * Per-token reason why this token is unusable by `reservedFor` right now.
   * Returns one entry per token in the pool, used by callers to build a
   * concrete refusal error ("Phong is in use by N chats") instead
   * of the generic "all tokens unavailable" string.
   */
  describeUnavailability(reservedFor?: string): TokenUnavailability[] {
    const now = this.now()
    const out: TokenUnavailability[] = []
    for (const t of this.readTokens()) {
      const base = { tokenId: t.id, label: t.label }
      if (t.status === "disabled") {
        out.push({ ...base, reason: "disabled" })
        continue
      }
      if (t.status === "error") {
        out.push({ ...base, reason: "error", message: t.lastErrorMessage ?? null })
        continue
      }
      const owners = this.getOwners(t.id)
      const ownedBySelf = reservedFor !== undefined && owners.has(reservedFor)
      const atCap = owners.size >= this.tokenCap(t)
      if (atCap && !ownedBySelf) {
        out.push({ ...base, reason: "reserved", byChatIds: [...owners], ownedBySelf })
        continue
      }
      if (t.status === "limited" && t.limitedUntil !== null && t.limitedUntil > now) {
        out.push({ ...base, reason: "limited", until: t.limitedUntil })
        continue
      }
      out.push({ ...base, reason: "available" })
    }
    return out
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
