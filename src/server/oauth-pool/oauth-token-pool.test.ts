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

  test("skips disabled tokens", () => {
    const pool = new OAuthTokenPool(
      () => [tok("a", { status: "disabled" }), tok("b")],
      () => {}, () => 1000,
    )
    expect(pool.pickActive()?.id).toBe("b")
  })

  test("returns null when all tokens are disabled", () => {
    const pool = new OAuthTokenPool(
      () => [tok("a", { status: "disabled" })],
      () => {}, () => 1000,
    )
    expect(pool.pickActive()).toBe(null)
  })
})

describe("OAuthTokenPool.markDisabled / markEnabled", () => {
  test("markDisabled writes status=disabled and drops reservation", () => {
    const updates: Array<{ id: string; patch: Partial<OAuthTokenEntry> }> = []
    let store = [tok("a"), tok("b")]
    const pool = new OAuthTokenPool(
      () => store,
      (id, patch) => {
        updates.push({ id, patch })
        store = store.map((t) => t.id === id ? { ...t, ...patch } : t)
      },
      () => 1000,
    )
    pool.pickActive("chat-1")
    pool.markDisabled("a")
    expect(updates.at(-1)).toEqual({ id: "a", patch: { status: "disabled" } })
    expect(pool.pickActive("chat-2")?.id).toBe("b")
  })

  test("markEnabled writes status=active", () => {
    const updates: Array<{ id: string; patch: Partial<OAuthTokenEntry> }> = []
    const pool = new OAuthTokenPool(
      () => [tok("a", { status: "disabled" })],
      (id, patch) => { updates.push({ id, patch }) },
      () => 1000,
    )
    pool.markEnabled("a")
    expect(updates).toEqual([{ id: "a", patch: { status: "active" } }])
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

  test("disabled tokens excluded from allLimited check", () => {
    const poolAllLimited = new OAuthTokenPool(
      () => [
        tok("a", { status: "disabled" }),
        tok("b", { status: "limited", limitedUntil: 9999 }),
      ],
      () => {}, () => 1000,
    )
    expect(poolAllLimited.allLimited()).toBe(true)

    const poolNotLimited = new OAuthTokenPool(
      () => [tok("a", { status: "disabled" }), tok("b")],
      () => {}, () => 1000,
    )
    expect(poolNotLimited.allLimited()).toBe(false)
  })

  test("false when only disabled tokens exist", () => {
    const pool = new OAuthTokenPool(
      () => [tok("a", { status: "disabled" })],
      () => {}, () => 1000,
    )
    expect(pool.allLimited()).toBe(false)
  })
})

describe("OAuthTokenPool.hasAnyToken", () => {
  test("false when pool is empty", () => {
    const pool = new OAuthTokenPool(() => [], () => {}, () => 1000)
    expect(pool.hasAnyToken()).toBe(false)
  })

  test("true when pool has any token regardless of status", () => {
    const cases: Array<OAuthTokenEntry["status"]> = ["active", "limited", "error", "disabled"]
    for (const status of cases) {
      const pool = new OAuthTokenPool(
        () => [tok("a", { status, limitedUntil: status === "limited" ? 9_999 : null })],
        () => {}, () => 1000,
      )
      expect(pool.hasAnyToken()).toBe(true)
    }
  })
})

describe("OAuthTokenPool.earliestUnlimit", () => {
  test("returns null when pool is empty", () => {
    const pool = new OAuthTokenPool(() => [], () => {}, () => 1000)
    expect(pool.earliestUnlimit()).toBe(null)
  })

  test("returns null when no token is limited", () => {
    const pool = new OAuthTokenPool(
      () => [tok("a"), tok("b")],
      () => {}, () => 1000,
    )
    expect(pool.earliestUnlimit()).toBe(null)
  })

  test("returns the smallest limitedUntil among future-limited tokens", () => {
    const pool = new OAuthTokenPool(
      () => [
        tok("a", { status: "limited", limitedUntil: 5000 }),
        tok("b", { status: "limited", limitedUntil: 3000 }),
        tok("c", { status: "limited", limitedUntil: 7000 }),
      ],
      () => {}, () => 1000,
    )
    expect(pool.earliestUnlimit()).toBe(3000)
  })

  test("ignores limited tokens whose limitedUntil has already passed", () => {
    const pool = new OAuthTokenPool(
      () => [
        tok("a", { status: "limited", limitedUntil: 500 }),
        tok("b", { status: "limited", limitedUntil: 4000 }),
      ],
      () => {}, () => 1000,
    )
    expect(pool.earliestUnlimit()).toBe(4000)
  })

  test("ignores error and active tokens", () => {
    const pool = new OAuthTokenPool(
      () => [
        tok("a", { status: "error" }),
        tok("b"),
        tok("c", { status: "limited", limitedUntil: 6000 }),
      ],
      () => {}, () => 1000,
    )
    expect(pool.earliestUnlimit()).toBe(6000)
  })
})

describe("OAuthTokenPool reservations (concurrent sessions)", () => {
  test("pickActive(chatId) skips tokens reserved by another chat", () => {
    let store = [tok("a"), tok("b")]
    const pool = new OAuthTokenPool(
      () => store,
      (id, patch) => { store = store.map((t) => t.id === id ? { ...t, ...patch } : t) },
      () => 1000,
    )
    const first = pool.pickActive("chat-1")
    expect(first?.id).toBe("a")
    const second = pool.pickActive("chat-2")
    expect(second?.id).toBe("b")
    const third = pool.pickActive("chat-3")
    expect(third).toBe(null)
  })

  test("pickActive(chatId) returns the same token if the same chat re-asks", () => {
    let store = [tok("a"), tok("b")]
    const pool = new OAuthTokenPool(
      () => store,
      (id, patch) => { store = store.map((t) => t.id === id ? { ...t, ...patch } : t) },
      () => 1000,
    )
    expect(pool.pickActive("chat-1")?.id).toBe("a")
    expect(pool.pickActive("chat-1")?.id).toBe("a")
  })

  test("release(chatId) frees the reservation for re-use", () => {
    let store = [tok("a"), tok("b")]
    const pool = new OAuthTokenPool(
      () => store,
      (id, patch) => { store = store.map((t) => t.id === id ? { ...t, ...patch } : t) },
      () => 1000,
    )
    pool.pickActive("chat-1")
    pool.pickActive("chat-2")
    expect(pool.pickActive("chat-3")).toBe(null)
    pool.release("chat-1")
    expect(pool.pickActive("chat-3")?.id).toBe("a")
  })

  test("markLimited drops the reservation on the limited token", () => {
    let store = [tok("a"), tok("b")]
    const pool = new OAuthTokenPool(
      () => store,
      (id, patch) => { store = store.map((t) => t.id === id ? { ...t, ...patch } : t) },
      () => 1000,
    )
    pool.pickActive("chat-1") // reserves a
    pool.markLimited("a", 9999) // a now limited; reservation must drop
    // chat-2 should still get b (a is limited, not reservation-blocking)
    expect(pool.pickActive("chat-2")?.id).toBe("b")
    // After b is also limited, chat-1 has nothing left.
    pool.markLimited("b", 9999)
    expect(pool.pickActive("chat-1")).toBe(null)
  })

  test("concurrent rate-limit hit on different tokens: each chat keeps own picks; no double-rotate", () => {
    let store = [tok("a"), tok("b"), tok("c")]
    const pool = new OAuthTokenPool(
      () => store,
      (id, patch) => { store = store.map((t) => t.id === id ? { ...t, ...patch } : t) },
      () => 1000,
    )
    // Initial pick: chat-1=a, chat-2=b, c idle.
    expect(pool.pickActive("chat-1")?.id).toBe("a")
    expect(pool.pickActive("chat-2")?.id).toBe("b")
    // Both hit rate-limit at the same time on their own token.
    pool.markLimited("a", 9999)
    pool.markLimited("b", 9999)
    // Each tries to rotate. Reservations prevent both from claiming c.
    const chat1Rot = pool.pickActive("chat-1")
    const chat2Rot = pool.pickActive("chat-2")
    const ids = [chat1Rot?.id, chat2Rot?.id].filter(Boolean)
    expect(ids).toContain("c")
    expect(ids.filter((id) => id === "c")).toHaveLength(1)
  })

  test("pickActive without chatId never claims a reservation", () => {
    let store = [tok("a"), tok("b")]
    const pool = new OAuthTokenPool(
      () => store,
      (id, patch) => { store = store.map((t) => t.id === id ? { ...t, ...patch } : t) },
      () => 1000,
    )
    const first = pool.pickActive()
    expect(first?.id).toBe("a")
    // No reservation taken; another caller can still get a.
    const second = pool.pickActive("chat-x")
    expect(second?.id).toBe("a")
  })
})
