import { describe, expect, test } from "bun:test"
import type { PaneTabTarget } from "../../lib/paneTree"
import { describeTab } from "./tabPresentation"

describe("describeTab", () => {
  test("names the singleton kind", () => {
    expect(describeTab({ kind: "changes" }, {}).label).toBe("Changes")
  })

  test("titles a chat tab from its chat", () => {
    const target: PaneTabTarget = { kind: "chat", chatId: "c1" }
    expect(describeTab(target, { chatTitles: { c1: "Fix the parser" } }).label).toBe(
      "Fix the parser",
    )
  })

  test("falls back to a generic chat label", () => {
    expect(describeTab({ kind: "chat", chatId: "c1" }, {}).label).toBe("Chat")
    expect(describeTab({ kind: "chat", chatId: "c1" }, { chatTitles: {} }).label).toBe("Chat")
  })

  test("titles each chat tab independently", () => {
    const titles = { a: "First", b: "Second" }
    expect(describeTab({ kind: "chat", chatId: "a" }, { chatTitles: titles }).label).toBe("First")
    expect(describeTab({ kind: "chat", chatId: "b" }, { chatTitles: titles }).label).toBe("Second")
  })

  test("uses the supplied terminal title when there is one", () => {
    const target: PaneTabTarget = { kind: "terminal", terminalId: "t1" }
    expect(describeTab(target, { terminalTitles: { t1: "Terminal B" } }).label).toBe("Terminal B")
  })

  test("falls back to a generic terminal label", () => {
    expect(describeTab({ kind: "terminal", terminalId: "t1" }, {}).label).toBe("Terminal")
  })

  test("gives every kind an icon", () => {
    const targets: PaneTabTarget[] = [
      { kind: "chat", chatId: "c1" },
      { kind: "changes" },
      { kind: "terminal", terminalId: "t1" },
    ]
    for (const target of targets) {
      expect(describeTab(target, {}).icon).toBeDefined()
    }
  })

  test("marks a running terminal as pinned so retention keeps it mounted", () => {
    const target: PaneTabTarget = { kind: "terminal", terminalId: "t1" }
    expect(describeTab(target, { liveTerminalIds: new Set(["t1"]) }).pinned).toBe(true)
    expect(describeTab(target, { liveTerminalIds: new Set() }).pinned).toBe(false)
    expect(describeTab({ kind: "chat", chatId: "c1" }, {}).pinned).toBe(false)
  })

  test("marks a busy chat as pinned so retention keeps it mounted", () => {
    const target: PaneTabTarget = { kind: "chat", chatId: "c1" }
    const busy = { status: "running", unread: false } as const
    expect(describeTab(target, { chatStatuses: { c1: busy } }).pinned).toBe(true)
    expect(describeTab(target, { chatStatuses: { c1: { status: "starting", unread: false } } }).pinned).toBe(true)
    expect(describeTab(target, { chatStatuses: { other: busy } }).pinned).toBe(false)
    expect(describeTab(target, { chatStatuses: { c1: { status: "idle", unread: true } } }).pinned).toBe(false)
    expect(describeTab(target, { chatStatuses: {} }).pinned).toBe(false)
  })

  test("a chat tab mirrors the sidebar's status dot", () => {
    const target: PaneTabTarget = { kind: "chat", chatId: "c1" }
    const running = describeTab(target, {
      chatStatuses: { c1: { status: "running", unread: false } },
    })
    expect(running.indicator).toEqual({ tone: "warning", label: "Running" })

    const waiting = describeTab(target, {
      chatStatuses: { c1: { status: "waiting_for_user", unread: false } },
    })
    expect(waiting.indicator?.tone).toBe("info")
  })

  test("a quiet chat and an unknown chat carry no indicator", () => {
    const target: PaneTabTarget = { kind: "chat", chatId: "c1" }
    expect(describeTab(target, { chatStatuses: { c1: { status: "idle", unread: false } } }).indicator).toBeNull()
    expect(describeTab(target, {}).indicator).toBeNull()
  })

  test("a chat tab carries the PTY session badge, and only while the session lives", () => {
    const target: PaneTabTarget = { kind: "chat", chatId: "c1" }
    const active = describeTab(target, {
      chatStatuses: { c1: { status: "idle", unread: false, sessionState: "active" } },
    })
    expect(active.sessionBadge?.kind).toBe("filled")
    expect(active.sessionBadge?.toneClass).toBe("text-success-text")

    const cold = describeTab(target, {
      chatStatuses: { c1: { status: "idle", unread: false, sessionState: "cold" } },
    })
    expect(cold.sessionBadge).toBeNull()
  })

  test("non-chat tabs never carry chat status", () => {
    expect(describeTab({ kind: "changes" }, {}).indicator).toBeNull()
    expect(describeTab({ kind: "changes" }, {}).sessionBadge).toBeNull()
    const terminal = describeTab({ kind: "terminal", terminalId: "t1" }, { liveTerminalIds: new Set(["t1"]) })
    expect(terminal.indicator).toBeNull()
    expect(terminal.sessionBadge).toBeNull()
  })

  test("every kind is closable", () => {
    expect(describeTab({ kind: "chat", chatId: "c1" }, {}).closable).toBe(true)
    expect(describeTab({ kind: "changes" }, {}).closable).toBe(true)
    expect(describeTab({ kind: "terminal", terminalId: "t1" }, {}).closable).toBe(true)
  })
})
