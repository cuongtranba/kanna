import type { OAuthTokenEntry } from "../../shared/types"
import { OAUTH_TOKEN_CONCURRENCY_DEFAULT, clampTokenConcurrency } from "../../shared/types"

export type TokenStatusPatch = Partial<Pick<OAuthTokenEntry,
  "status" | "limitedUntil" | "lastUsedAt" | "lastErrorAt" | "lastErrorMessage"
>>

export type TokenUnavailability =
  | { tokenId: string; label: string; reason: "available" }
  | { tokenId: string; label: string; reason: "limited"; until: number }
  | { tokenId: string; label: string; reason: "reserved"; byChatIds: string[]; ownedBySelf: boolean }
  | { tokenId: string; label: string; reason: "error"; message: string | null }
  | { tokenId: string; label: string; reason: "disabled" }

export interface EphemeralLease {
  token: OAuthTokenEntry
  release(): void
}

export class OAuthTokenPool {
  private readonly reservedBy = new Map<string, Set<string>>()

  private ephemeralSeq = 0

  constructor(
    private readonly readTokens: () => OAuthTokenEntry[],
    private readonly writeStatus: (id: string, patch: TokenStatusPatch) => void,
    private readonly now: () => number = Date.now,
    private readonly readGlobalCap: () => number = () => OAUTH_TOKEN_CONCURRENCY_DEFAULT,
  ) {}

  private tokenCap(t: OAuthTokenEntry): number {
    const raw = typeof t.maxConcurrent === "number" && Number.isFinite(t.maxConcurrent)
      ? t.maxConcurrent
      : this.readGlobalCap()
    return clampTokenConcurrency(raw)
  }

  private getOwners(tokenId: string): Set<string> {
    return this.reservedBy.get(tokenId) ?? new Set()
  }

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
    const candidates: OAuthTokenEntry[] = []
    for (const t of this.readTokens()) {
      if (!this.isEligible(t, now, reservedFor)) continue
      candidates.push(t)
    }
    if (candidates.length === 0) return null
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
      this.removeOwnerExcept(reservedFor, result.id)
      const owners = this.reservedBy.get(result.id) ?? new Set<string>()
      owners.add(reservedFor)
      this.reservedBy.set(result.id, owners)
    }
    return result
  }

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
    this.reservedBy.delete(id)
  }

  markUsed(id: string): void {
    this.writeStatus(id, { lastUsedAt: this.now() })
  }

  markError(id: string, message: string): void {
    this.writeStatus(id, { status: "error", lastErrorAt: this.now(), lastErrorMessage: message })
    this.reservedBy.delete(id)
  }

  markDisabled(id: string): void {
    this.writeStatus(id, { status: "disabled" })
    this.reservedBy.delete(id)
  }

  markEnabled(id: string): void {
    this.writeStatus(id, { status: "active" })
  }

  takeStaleOwners(id: string): string[] {
    const owners = this.reservedBy.get(id)
    if (!owners || owners.size === 0) return []
    const out = [...owners]
    this.reservedBy.delete(id)
    return out
  }

  hasAnyToken(): boolean {
    return this.readTokens().length > 0
  }

  hasUsable(reservedFor?: string): boolean {
    const now = this.now()
    for (const t of this.readTokens()) {
      if (this.isEligible(t, now, reservedFor)) return true
    }
    return false
  }

  allLimited(): boolean {
    const eligible = this.readTokens().filter((t) => t.status !== "disabled" && t.status !== "error")
    if (eligible.length === 0) return false
    const now = this.now()
    return eligible.every((t) => t.status === "limited" && t.limitedUntil !== null && t.limitedUntil > now)
  }

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
