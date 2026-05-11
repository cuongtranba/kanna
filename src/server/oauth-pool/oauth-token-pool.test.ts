import { describe, expect, test } from "bun:test"
import { OAuthTokenPool } from "./oauth-token-pool"
import type { OAuthTokenEntry } from "../../shared/types"

function tok(id: string, overrides: Partial<OAuthTokenEntry> = {}): OAuthTokenEntry {
  return {
    id, label: id, token: `sk-ant-${id}`,
    status: "active", limitedUntil: null,
    lastUsedAt: null, lastErrorAt: null, lastErrorMessage: null,
    addedAt: 0, ...overrides,
  }
}

describe("OAuthTokenPool.pickActive", () => {
  test("returns null when pool is empty", () => {
    const pool = new OAuthTokenPool(() => [], () => {}, () => 1000)
    expect(pool.pickActive()).toBe(null)
  })

  test("returns the only active token", () => {
    const pool = new OAuthTokenPool(() => [tok("a")], () => {}, () => 1000)
    expect(pool.pickActive()?.id).toBe("a")
  })

  test("skips tokens whose limitedUntil is still in the future", () => {
    const pool = new OAuthTokenPool(
      () => [tok("a", { status: "limited", limitedUntil: 5000 }), tok("b")],
      () => {}, () => 1000,
    )
    expect(pool.pickActive()?.id).toBe("b")
  })

  test("revives limited tokens whose limitedUntil has passed", () => {
    const updates: Array<{ id: string; patch: Partial<OAuthTokenEntry> }> = []
    const pool = new OAuthTokenPool(
      () => [tok("a", { status: "limited", limitedUntil: 500 })],
      (id, patch) => { updates.push({ id, patch }) },
      () => 1000,
    )
    expect(pool.pickActive()?.id).toBe("a")
    expect(updates).toEqual([{ id: "a", patch: { status: "active", limitedUntil: null } }])
  })

  test("least-recently-used active wins (round-robin)", () => {
    const pool = new OAuthTokenPool(
      () => [
        tok("a", { lastUsedAt: 900 }),
        tok("b", { lastUsedAt: 800 }),
        tok("c", { lastUsedAt: null }),
      ],
      () => {}, () => 1000,
    )
    expect(pool.pickActive()?.id).toBe("c")
  })

  test("skips error-status tokens", () => {
    const pool = new OAuthTokenPool(
      () => [tok("a", { status: "error" }), tok("b")],
      () => {}, () => 1000,
    )
    expect(pool.pickActive()?.id).toBe("b")
  })

  test("returns null when all tokens are error-status", () => {
    const pool = new OAuthTokenPool(
      () => [tok("a", { status: "error" })],
      () => {}, () => 1000,
    )
    expect(pool.pickActive()).toBe(null)
  })
})

describe("OAuthTokenPool.markLimited", () => {
  test("writes status=limited with resetAt", () => {
    const updates: Array<{ id: string; patch: Partial<OAuthTokenEntry> }> = []
    const pool = new OAuthTokenPool(
      () => [tok("a")],
      (id, patch) => { updates.push({ id, patch }) },
      () => 1000,
    )
    pool.markLimited("a", 9999)
    expect(updates).toEqual([{ id: "a", patch: { status: "limited", limitedUntil: 9999 } }])
  })
})

describe("OAuthTokenPool.markUsed", () => {
  test("writes lastUsedAt = now()", () => {
    const updates: Array<{ id: string; patch: Partial<OAuthTokenEntry> }> = []
    const pool = new OAuthTokenPool(
      () => [tok("a")],
      (id, patch) => { updates.push({ id, patch }) },
      () => 1234,
    )
    pool.markUsed("a")
    expect(updates).toEqual([{ id: "a", patch: { lastUsedAt: 1234 } }])
  })
})

describe("OAuthTokenPool.allLimited", () => {
  test("true when every token is limited in the future", () => {
    const pool = new OAuthTokenPool(
      () => [
        tok("a", { status: "limited", limitedUntil: 9999 }),
        tok("b", { status: "limited", limitedUntil: 9999 }),
      ],
      () => {}, () => 1000,
    )
    expect(pool.allLimited()).toBe(true)
  })

  test("false when at least one active or expired-limited", () => {
    const pool = new OAuthTokenPool(
      () => [
        tok("a", { status: "limited", limitedUntil: 9999 }),
        tok("b"),
      ],
      () => {}, () => 1000,
    )
    expect(pool.allLimited()).toBe(false)
  })

  test("false when pool is empty (caller should fall back to env)", () => {
    const pool = new OAuthTokenPool(() => [], () => {}, () => 1000)
    expect(pool.allLimited()).toBe(false)
  })
})
