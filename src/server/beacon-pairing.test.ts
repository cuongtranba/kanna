import { describe, expect, test } from "bun:test"
import { createBeaconPairingStore } from "./beacon-pairing"

describe("beacon pairing store", () => {
  test("a minted code redeems once and is unknown afterwards", () => {
    const store = createBeaconPairingStore()
    const { code } = store.mint()
    expect(store.redeem(code)).toEqual({ ok: true })
    expect(store.redeem(code)).toEqual({ ok: false, reason: "unknown" })
  })

  test("a code redeemed after its ttl is expired", () => {
    let clock = 1_000
    const store = createBeaconPairingStore({ now: () => clock, ttlMs: 500 })
    const { code, expiresAt } = store.mint()
    expect(expiresAt).toBe(1_500)
    clock = 1_500
    expect(store.redeem(code)).toEqual({ ok: false, reason: "expired" })
  })

  test("a code that was never minted is unknown", () => {
    expect(createBeaconPairingStore().redeem("NOPE0000")).toEqual({ ok: false, reason: "unknown" })
  })
})
