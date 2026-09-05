import { describe, expect, test } from "bun:test"
import { buildTabId, isSingletonTabKind, normalizeTabTarget, tabTargetsEqual } from "./tabTarget"
import type { PaneTabTarget } from "./types"

describe("buildTabId", () => {
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

  test("distinguishes chats, so a second open chat is a second tab", () => {
    expect(buildTabId({ kind: "chat", chatId: "a" })).not.toBe(
      buildTabId({ kind: "chat", chatId: "b" }),
    )
  })

  test("cannot be collided by a separator inside an id", () => {
    expect(buildTabId({ kind: "terminal", terminalId: "a_b" })).not.toBe(
      `${buildTabId({ kind: "terminal", terminalId: "a" })}_b`,
    )
    expect(buildTabId({ kind: "chat", chatId: "a_b" })).not.toBe(
      `${buildTabId({ kind: "chat", chatId: "a" })}_b`,
    )
  })

  test("does not collide a chat with a terminal of the same id", () => {
    expect(buildTabId({ kind: "chat", chatId: "x" })).not.toBe(
      buildTabId({ kind: "terminal", terminalId: "x" }),
    )
  })
})

describe("isSingletonTabKind", () => {
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
