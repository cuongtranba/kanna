import { describe, expect, test } from "bun:test"
import type { PaneTabTarget } from "../../lib/paneTree"
import { describeTab } from "./tabPresentation"

describe("describeTab", () => {
  test("names the singleton kind", () => {
    expect(describeTab({ kind: "changes" }, {}).label).toBe("Changes")
  })

  /**
   * With N chat tabs open, a shared "Chat" label makes them indistinguishable —
   * the title is what tells the user which transcript a tab holds.
   */
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

  // Terminals were labelled "Terminal A", "Terminal B" in the old store but the
  // label was never rendered; the tab strip is where it finally shows.
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

  // A live terminal must not be torn down by the retention LRU, so it declares
  // itself pinned; an idle chat and changes can be remounted cheaply.
  test("marks a running terminal as pinned so retention keeps it mounted", () => {
    const target: PaneTabTarget = { kind: "terminal", terminalId: "t1" }
    expect(describeTab(target, { liveTerminalIds: new Set(["t1"]) }).pinned).toBe(true)
    expect(describeTab(target, { liveTerminalIds: new Set() }).pinned).toBe(false)
    expect(describeTab({ kind: "chat", chatId: "c1" }, {}).pinned).toBe(false)
  })

  /**
   * A chat streaming a turn is live state: if retention unmounts it, the
   * in-flight output is lost. Same reasoning as a running terminal — and it is
   * read off the one status map, not a second busy-id set free to disagree.
   */
  test("marks a busy chat as pinned so retention keeps it mounted", () => {
    const target: PaneTabTarget = { kind: "chat", chatId: "c1" }
    const busy = { status: "running", unread: false } as const
    expect(describeTab(target, { chatStatuses: { c1: busy } }).pinned).toBe(true)
    expect(describeTab(target, { chatStatuses: { c1: { status: "starting", unread: false } } }).pinned).toBe(true)
    expect(describeTab(target, { chatStatuses: { other: busy } }).pinned).toBe(false)
    expect(describeTab(target, { chatStatuses: { c1: { status: "idle", unread: true } } }).pinned).toBe(false)
    expect(describeTab(target, { chatStatuses: {} }).pinned).toBe(false)
  })

  /**
   * The whole point of the tab dot: it is the SAME derivation the sidebar row
   * uses, so the same chat cannot read "Running" on the left and blank on top.
   */
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

  // A quiet chat keeps its icon: a dot on every tab would make the dot noise.
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
    expect(active.sessionBadge?.glyph).toBe("●")
    expect(active.sessionBadge?.toneClass).toBe("text-success")

    const cold = describeTab(target, {
      chatStatuses: { c1: { status: "idle", unread: false, sessionState: "cold" } },
    })
    expect(cold.sessionBadge).toBeNull()
  })

  // Status belongs to chats. A terminal has its own liveness signal and
  // `changes` has no session at all — borrowing the chat vocabulary there
  // would make the dot mean two different things.
  test("non-chat tabs never carry chat status", () => {
    expect(describeTab({ kind: "changes" }, {}).indicator).toBeNull()
    expect(describeTab({ kind: "changes" }, {}).sessionBadge).toBeNull()
    const terminal = describeTab({ kind: "terminal", terminalId: "t1" }, { liveTerminalIds: new Set(["t1"]) })
    expect(terminal.indicator).toBeNull()
    expect(terminal.sessionBadge).toBeNull()
  })

  // A chat tab became closable when it stopped being the only one: a pane with
  // no tabs is valid, and ChatPage re-opens a tab for the chat in the URL.
  test("every kind is closable", () => {
    expect(describeTab({ kind: "chat", chatId: "c1" }, {}).closable).toBe(true)
    expect(describeTab({ kind: "changes" }, {}).closable).toBe(true)
    expect(describeTab({ kind: "terminal", terminalId: "t1" }, {}).closable).toBe(true)
  })
})
