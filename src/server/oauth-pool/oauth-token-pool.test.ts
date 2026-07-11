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

  test("markError releases the dead token's reservation", () => {
    let store = [tok("a"), tok("b")]
    const pool = new OAuthTokenPool(
      () => store,
      (id, patch) => { store = store.map((t) => t.id === id ? { ...t, ...patch } : t) },
      () => 1000,
    )
    pool.pickActive("chat-1") // reserves "a"
    pool.markError("a", "401")
    // chat-2 (which never touched "a") must be able to claim "b" — even
    // though "a" was reserved by chat-1 before markError. Without dropping
    // the reservation, errored-status check already skips "a" anyway, but
    // we assert markError leaves no stale entry in reservedBy.
    expect(pool.pickActive("chat-2")?.id).toBe("b")
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

describe("OAuthTokenPool.hasUsable (TOCTOU parity with pickActive)", () => {
  test("respects reservations: a token reserved by chat-A is NOT usable from chat-B", () => {
    let store = [tok("a")]
    const pool = new OAuthTokenPool(
      () => store,
      (id, patch) => { store = store.map((t) => t.id === id ? { ...t, ...patch } : t) },
      () => 1000,
    )
    pool.pickActive("chat-A")
    expect(pool.hasUsable("chat-B")).toBe(false)
    // Owner sees their own reservation as usable.
    expect(pool.hasUsable("chat-A")).toBe(true)
  })

  test("returns false when every token is reserved elsewhere", () => {
    let store = [tok("a"), tok("b")]
    const pool = new OAuthTokenPool(
      () => store,
      (id, patch) => { store = store.map((t) => t.id === id ? { ...t, ...patch } : t) },
      () => 1000,
    )
    pool.pickActive("chat-A")
    pool.pickActive("chat-B")
    expect(pool.hasUsable("chat-C")).toBe(false)
    // And the matching pickActive agrees — TOCTOU gap closed.
    expect(pool.pickActive("chat-C")).toBeNull()
  })

  test("does NOT mutate status for elapsed-limited tokens (read-only)", () => {
    const writes: Array<{ id: string; patch: unknown }> = []
    const now = 1000
    const store = [tok("a", { status: "limited", limitedUntil: 500 })]
    const pool = new OAuthTokenPool(
      () => store,
      (id, patch) => { writes.push({ id, patch }) },
      () => now,
    )
    expect(pool.hasUsable()).toBe(true)
    expect(writes).toEqual([])
    // pickActive does revive on commit, hasUsable does not.
    pool.pickActive("chat-A")
    expect(writes.length).toBeGreaterThan(0)
  })
})

describe("OAuthTokenPool.pickEphemeral", () => {
  test("returns null when no tokens", () => {
    const pool = new OAuthTokenPool(() => [], () => {}, () => 1000)
    expect(pool.pickEphemeral()).toBeNull()
  })

  test("two concurrent ephemerals get DIFFERENT tokens (no shared pick)", () => {
    let store = [tok("a"), tok("b")]
    const pool = new OAuthTokenPool(
      () => store,
      (id, patch) => { store = store.map((t) => t.id === id ? { ...t, ...patch } : t) },
      () => 1000,
    )
    const lease1 = pool.pickEphemeral()
    const lease2 = pool.pickEphemeral()
    expect(lease1?.token.id).toBeDefined()
    expect(lease2?.token.id).toBeDefined()
    expect(lease1?.token.id).not.toBe(lease2?.token.id)
  })

  test("only-one-token pool → second concurrent ephemeral returns null until first releases", () => {
    let store = [tok("a")]
    const pool = new OAuthTokenPool(
      () => store,
      (id, patch) => { store = store.map((t) => t.id === id ? { ...t, ...patch } : t) },
      () => 1000,
    )
    const lease1 = pool.pickEphemeral()
    expect(lease1?.token.id).toBe("a")
    expect(pool.pickEphemeral()).toBeNull()
    lease1?.release()
    expect(pool.pickEphemeral()?.token.id).toBe("a")
  })

  test("release() is idempotent", () => {
    let store = [tok("a")]
    const pool = new OAuthTokenPool(
      () => store,
      (id, patch) => { store = store.map((t) => t.id === id ? { ...t, ...patch } : t) },
      () => 1000,
    )
    const lease = pool.pickEphemeral()
    lease?.release()
    lease?.release() // no throw, no spurious reservation re-cleanup
    expect(pool.pickEphemeral()?.token.id).toBe("a")
  })

  test("ephemeral lease does not block a chat-bound pickActive for a DIFFERENT token", () => {
    let store = [tok("a"), tok("b")]
    const pool = new OAuthTokenPool(
      () => store,
      (id, patch) => { store = store.map((t) => t.id === id ? { ...t, ...patch } : t) },
      () => 1000,
    )
    const lease = pool.pickEphemeral()
    const otherTokenId = lease?.token.id === "a" ? "b" : "a"
    expect(pool.pickActive("chat-A")?.id).toBe(otherTokenId)
  })
})

describe("OAuthTokenPool.pickActive (pure read loop, deferred revival)", () => {
  test("does NOT call writeStatus on tokens it ultimately does not pick", () => {
    // Two elapsed-limited tokens. pickActive should pick exactly ONE (LRU)
    // and only emit ONE revival writeStatus — the previous implementation
    // wrote status for every elapsed candidate inside the read loop.
    const writes: Array<{ id: string; patch: unknown }> = []
    const store = [
      tok("a", { status: "limited", limitedUntil: 500, lastUsedAt: 100 }),
      tok("b", { status: "limited", limitedUntil: 500, lastUsedAt: 200 }),
    ]
    const pool = new OAuthTokenPool(
      () => store,
      (id, patch) => { writes.push({ id, patch }) },
      () => 1000,
    )
    const picked = pool.pickActive("chat-A")
    expect(picked?.id).toBe("a") // older lastUsedAt
    const revivals = writes.filter((w) => {
      const p = w.patch as { status?: string }
      return p.status === "active"
    })
    expect(revivals).toHaveLength(1)
    expect(revivals[0].id).toBe("a")
  })
})

describe("OAuthTokenPool.describeUnavailability", () => {
  test("classifies each token by reason for the calling chat", () => {
    const pool = new OAuthTokenPool(
      () => [
        tok("a", { label: "personal", status: "limited", limitedUntil: 5000 }),
        tok("b", { label: "company", status: "limited", limitedUntil: 6000 }),
        tok("c", { label: "Phong" }),
        tok("d", { label: "old", status: "error", lastErrorMessage: "401" }),
        tok("e", { label: "off", status: "disabled" }),
      ],
      () => {}, () => 1000,
    )
    // pin Phong to a different chat
    pool.pickActive("chat-other")
    const result = pool.describeUnavailability("chat-new")
    const byId = new Map(result.map((r) => [r.tokenId, r]))
    expect(byId.get("a")).toEqual({ tokenId: "a", label: "personal", reason: "limited", until: 5000 })
    expect(byId.get("b")).toEqual({ tokenId: "b", label: "company", reason: "limited", until: 6000 })
    expect(byId.get("c")).toEqual({ tokenId: "c", label: "Phong", reason: "reserved", byChatIds: ["chat-other"], ownedBySelf: false })
    expect(byId.get("d")).toEqual({ tokenId: "d", label: "old", reason: "error", message: "401" })
    expect(byId.get("e")).toEqual({ tokenId: "e", label: "off", reason: "disabled" })
  })

  test("marks expired-limited tokens as available", () => {
    const pool = new OAuthTokenPool(
      () => [tok("a", { label: "x", status: "limited", limitedUntil: 500 })],
      () => {}, () => 1000,
    )
    expect(pool.describeUnavailability("chat-new")).toEqual([
      { tokenId: "a", label: "x", reason: "available" },
    ])
  })

  test("reservation owned by self is reported as available", () => {
    const pool = new OAuthTokenPool(
      () => [tok("a", { label: "x" })],
      () => {}, () => 1000,
    )
    pool.pickActive("chat-self")
    expect(pool.describeUnavailability("chat-self")).toEqual([
      { tokenId: "a", label: "x", reason: "available" },
    ])
  })
})

describe("OAuthTokenPool concurrency cap (adr-20260522-oauth-token-share-cap)", () => {
  test("per-token maxConcurrent=2 admits two chats, blocks third", () => {
    const pool = new OAuthTokenPool(
      () => [tok("a", { maxConcurrent: 2 })],
      () => {}, () => 1000,
    )
    expect(pool.pickActive("chat-1")?.id).toBe("a")
    expect(pool.pickActive("chat-2")?.id).toBe("a")
    expect(pool.pickActive("chat-3")).toBe(null)
  })

  test("release of one shared owner frees a cap slot", () => {
    const pool = new OAuthTokenPool(
      () => [tok("a", { maxConcurrent: 2 })],
      () => {}, () => 1000,
    )
    pool.pickActive("chat-1")
    pool.pickActive("chat-2")
    expect(pool.pickActive("chat-3")).toBe(null)
    pool.release("chat-1")
    expect(pool.pickActive("chat-3")?.id).toBe("a")
    // chat-2 still owns it, so chat-1 cannot crash-overcommit
    pool.release("chat-3")
    expect(pool.describeUnavailability("chat-4")).toEqual([
      { tokenId: "a", label: "a", reason: "available" },
    ])
  })

  test("global default cap applies when token omits maxConcurrent", () => {
    const pool = new OAuthTokenPool(
      () => [tok("a")],
      () => {}, () => 1000,
      () => 3, // global cap = 3
    )
    expect(pool.pickActive("c1")?.id).toBe("a")
    expect(pool.pickActive("c2")?.id).toBe("a")
    expect(pool.pickActive("c3")?.id).toBe("a")
    expect(pool.pickActive("c4")).toBe(null)
  })

  test("per-token maxConcurrent overrides global default", () => {
    const pool = new OAuthTokenPool(
      () => [tok("a", { maxConcurrent: 1 }), tok("b", { maxConcurrent: 2 })],
      () => {}, () => 1000,
      () => 5,
    )
    // a (cap=1) and b (cap=2) both available; a wins LRU but cap=1 means
    // chat-2 falls through to b.
    expect(pool.pickActive("chat-1")?.id).toBe("a")
    expect(pool.pickActive("chat-2")?.id).toBe("b")
    expect(pool.pickActive("chat-3")?.id).toBe("b")
    expect(pool.pickActive("chat-4")).toBe(null)
  })

  test("pickActive spreads load by owner count before LRU tiebreaker", () => {
    const pool = new OAuthTokenPool(
      () => [tok("a", { maxConcurrent: 2, lastUsedAt: 1 }), tok("b", { maxConcurrent: 2, lastUsedAt: 2 })],
      () => {}, () => 1000,
    )
    // a is LRU-first. chat-1 picks a. chat-2 should pick b (owner count
    // 0 < a's 1), not stack on a.
    expect(pool.pickActive("chat-1")?.id).toBe("a")
    expect(pool.pickActive("chat-2")?.id).toBe("b")
  })

  test("release scans all sets — refcount semantics", () => {
    const pool = new OAuthTokenPool(
      () => [tok("a", { maxConcurrent: 3 })],
      () => {}, () => 1000,
    )
    pool.pickActive("c1")
    pool.pickActive("c2")
    pool.pickActive("c3")
    pool.release("c2")
    // c1, c3 still own the token; new chat blocked because 2/3.
    // Add a new chat (c4) — should fit since 1 slot free.
    expect(pool.pickActive("c4")?.id).toBe("a")
    // Now 3/3 again, c5 blocked.
    expect(pool.pickActive("c5")).toBe(null)
  })

  test("takeStaleOwners returns and clears the owner set", () => {
    const pool = new OAuthTokenPool(
      () => [tok("a", { maxConcurrent: 2 })],
      () => {}, () => 1000,
    )
    pool.pickActive("chat-1")
    pool.pickActive("chat-2")
    const taken = pool.takeStaleOwners("a").sort()
    expect(taken).toEqual(["chat-1", "chat-2"])
    // Owners cleared — token immediately available again.
    expect(pool.pickActive("chat-3")?.id).toBe("a")
  })

  test("describeUnavailability lists all owners when token at cap", () => {
    const pool = new OAuthTokenPool(
      () => [tok("a", { label: "shared", maxConcurrent: 2 })],
      () => {}, () => 1000,
    )
    pool.pickActive("chat-1")
    pool.pickActive("chat-2")
    const result = pool.describeUnavailability("chat-3")
    expect(result).toHaveLength(1)
    const entry = result[0]
    expect(entry.reason).toBe("reserved")
    if (entry.reason !== "reserved") return
    expect(entry.byChatIds.sort()).toEqual(["chat-1", "chat-2"])
    expect(entry.ownedBySelf).toBe(false)
  })
})
