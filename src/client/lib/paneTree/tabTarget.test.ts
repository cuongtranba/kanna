import { describe, expect, test } from "bun:test"
import { buildTabId, isSingletonTabKind, normalizeTabTarget, tabTargetsEqual } from "./tabTarget"
import type { PaneTabTarget } from "./types"

describe("buildTabId", () => {
  // Deriving the id from the target is what makes "open" idempotent: asking for
  // a target that is already open resolves to the same tab rather than a duplicate.
  test("is deterministic for the same target", () => {
    expect(buildTabId({ kind: "terminal", terminalId: "t1" })).toBe(
      buildTabId({ kind: "terminal", terminalId: "t1" }),
    )
  })

  test("gives the singleton kinds a bare literal id", () => {
    expect(buildTabId({ kind: "chat" })).toBe("chat")
    expect(buildTabId({ kind: "changes" })).toBe("changes")
  })

  test("distinguishes terminals", () => {
    expect(buildTabId({ kind: "terminal", terminalId: "a" })).not.toBe(
      buildTabId({ kind: "terminal", terminalId: "b" }),
    )
  })

  // Length-prefixing each component means a separator inside an id cannot forge
  // a different target's key.
  test("cannot be collided by a separator inside an id", () => {
    expect(buildTabId({ kind: "terminal", terminalId: "a_b" })).not.toBe(
      `${buildTabId({ kind: "terminal", terminalId: "a" })}_b`,
    )
  })
})

describe("isSingletonTabKind", () => {
  test("marks chat and changes as singletons and terminal as not", () => {
    expect(isSingletonTabKind("chat")).toBe(true)
    expect(isSingletonTabKind("changes")).toBe(true)
    expect(isSingletonTabKind("terminal")).toBe(false)
  })
})

describe("normalizeTabTarget", () => {
  test("passes valid targets through", () => {
    expect(normalizeTabTarget({ kind: "chat" })).toEqual({ kind: "chat" })
    expect(normalizeTabTarget({ kind: "terminal", terminalId: "t1" })).toEqual({
      kind: "terminal",
      terminalId: "t1",
    })
  })

  test("trims a terminal id", () => {
    expect(normalizeTabTarget({ kind: "terminal", terminalId: "  t1  " })).toEqual({
      kind: "terminal",
      terminalId: "t1",
    })
  })

  // Persisted layouts are untrusted input; anything unusable is dropped rather
  // than carried into the tree, so no structural migration is ever needed.
  test("rejects anything unusable", () => {
    expect(normalizeTabTarget({ kind: "terminal", terminalId: "" })).toBeNull()
    expect(normalizeTabTarget({ kind: "terminal", terminalId: "   " })).toBeNull()
    expect(normalizeTabTarget({ kind: "terminal" })).toBeNull()
    expect(normalizeTabTarget({ kind: "nope" })).toBeNull()
    expect(normalizeTabTarget(null)).toBeNull()
    expect(normalizeTabTarget(undefined)).toBeNull()
    expect(normalizeTabTarget("chat")).toBeNull()
    expect(normalizeTabTarget(42)).toBeNull()
    expect(normalizeTabTarget({})).toBeNull()
  })
})

describe("tabTargetsEqual", () => {
  test("compares structurally, per variant", () => {
    expect(tabTargetsEqual({ kind: "chat" }, { kind: "chat" })).toBe(true)
    expect(tabTargetsEqual({ kind: "chat" }, { kind: "changes" })).toBe(false)
    expect(
      tabTargetsEqual({ kind: "terminal", terminalId: "a" }, { kind: "terminal", terminalId: "a" }),
    ).toBe(true)
    expect(
      tabTargetsEqual({ kind: "terminal", terminalId: "a" }, { kind: "terminal", terminalId: "b" }),
    ).toBe(false)
  })

  test("agrees with buildTabId across every kind", () => {
    const targets: PaneTabTarget[] = [
      { kind: "chat" },
      { kind: "changes" },
      { kind: "terminal", terminalId: "a" },
      { kind: "terminal", terminalId: "b" },
    ]
    for (const left of targets) {
      for (const right of targets) {
        expect(tabTargetsEqual(left, right)).toBe(buildTabId(left) === buildTabId(right))
      }
    }
  })
})
