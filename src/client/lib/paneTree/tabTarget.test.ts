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
    expect(buildTabId({ kind: "chat", chatId: "c1" })).toBe(
      buildTabId({ kind: "chat", chatId: "c1" }),
    )
  })

  test("gives the singleton kind a bare literal id", () => {
    expect(buildTabId({ kind: "changes" })).toBe("changes")
  })

  test("distinguishes terminals", () => {
    expect(buildTabId({ kind: "terminal", terminalId: "a" })).not.toBe(
      buildTabId({ kind: "terminal", terminalId: "b" }),
    )
  })

  /**
   * THE tab-per-chat invariant. Two chats must resolve to two ids, or `openTab`
   * dedups the second one onto the first and the app shows a single tab no
   * matter how many chats are open — the exact bug this addressing change fixes.
   */
  test("distinguishes chats, so a second open chat is a second tab", () => {
    expect(buildTabId({ kind: "chat", chatId: "a" })).not.toBe(
      buildTabId({ kind: "chat", chatId: "b" }),
    )
  })

  // Length-prefixing each component means a separator inside an id cannot forge
  // a different target's key.
  test("cannot be collided by a separator inside an id", () => {
    expect(buildTabId({ kind: "terminal", terminalId: "a_b" })).not.toBe(
      `${buildTabId({ kind: "terminal", terminalId: "a" })}_b`,
    )
    expect(buildTabId({ kind: "chat", chatId: "a_b" })).not.toBe(
      `${buildTabId({ kind: "chat", chatId: "a" })}_b`,
    )
  })

  // A chat id and a terminal id of the same text address different things.
  test("does not collide a chat with a terminal of the same id", () => {
    expect(buildTabId({ kind: "chat", chatId: "x" })).not.toBe(
      buildTabId({ kind: "terminal", terminalId: "x" }),
    )
  })
})

describe("isSingletonTabKind", () => {
  // chat left the singleton set when chat tabs gained a chatId: N open chats
  // must produce N tabs, each with its own live transcript.
  test("marks only changes as a singleton", () => {
    expect(isSingletonTabKind("chat")).toBe(false)
    expect(isSingletonTabKind("changes")).toBe(true)
    expect(isSingletonTabKind("terminal")).toBe(false)
  })
})

describe("normalizeTabTarget", () => {
  test("passes valid targets through", () => {
    expect(normalizeTabTarget({ kind: "chat", chatId: "c1" })).toEqual({
      kind: "chat",
      chatId: "c1",
    })
    expect(normalizeTabTarget({ kind: "changes" })).toEqual({ kind: "changes" })
    expect(normalizeTabTarget({ kind: "terminal", terminalId: "t1" })).toEqual({
      kind: "terminal",
      terminalId: "t1",
    })
  })

  test("trims ids", () => {
    expect(normalizeTabTarget({ kind: "terminal", terminalId: "  t1  " })).toEqual({
      kind: "terminal",
      terminalId: "t1",
    })
    expect(normalizeTabTarget({ kind: "chat", chatId: "  c1  " })).toEqual({
      kind: "chat",
      chatId: "c1",
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

  /**
   * This IS the migration for layouts saved before chat tabs were addressable.
   * Such a tab has no chatId to recover, so it is dropped on read; ChatPage then
   * opens a tab for the chat in the URL. Guessing an id here would resurrect a
   * tab pointing at the wrong chat.
   */
  test("drops a legacy chat tab that carries no chatId", () => {
    expect(normalizeTabTarget({ kind: "chat" })).toBeNull()
    expect(normalizeTabTarget({ kind: "chat", chatId: "" })).toBeNull()
    expect(normalizeTabTarget({ kind: "chat", chatId: "   " })).toBeNull()
    expect(normalizeTabTarget({ kind: "chat", chatId: 42 })).toBeNull()
  })
})

describe("tabTargetsEqual", () => {
  test("compares structurally, per variant", () => {
    expect(
      tabTargetsEqual({ kind: "chat", chatId: "a" }, { kind: "chat", chatId: "a" }),
    ).toBe(true)
    expect(
      tabTargetsEqual({ kind: "chat", chatId: "a" }, { kind: "chat", chatId: "b" }),
    ).toBe(false)
    expect(tabTargetsEqual({ kind: "chat", chatId: "a" }, { kind: "changes" })).toBe(false)
    expect(
      tabTargetsEqual({ kind: "terminal", terminalId: "a" }, { kind: "terminal", terminalId: "a" }),
    ).toBe(true)
    expect(
      tabTargetsEqual({ kind: "terminal", terminalId: "a" }, { kind: "terminal", terminalId: "b" }),
    ).toBe(false)
  })

  test("agrees with buildTabId across every kind", () => {
    const targets: PaneTabTarget[] = [
      { kind: "chat", chatId: "a" },
      { kind: "chat", chatId: "b" },
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
