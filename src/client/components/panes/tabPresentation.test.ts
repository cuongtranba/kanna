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
   * in-flight output is lost. Same reasoning as a running terminal.
   */
  test("marks a busy chat as pinned so retention keeps it mounted", () => {
    const target: PaneTabTarget = { kind: "chat", chatId: "c1" }
    expect(describeTab(target, { busyChatIds: new Set(["c1"]) }).pinned).toBe(true)
    expect(describeTab(target, { busyChatIds: new Set(["other"]) }).pinned).toBe(false)
    expect(describeTab(target, { busyChatIds: new Set() }).pinned).toBe(false)
  })

  // A chat tab became closable when it stopped being the only one: a pane with
  // no tabs is valid, and ChatPage re-opens a tab for the chat in the URL.
  test("every kind is closable", () => {
    expect(describeTab({ kind: "chat", chatId: "c1" }, {}).closable).toBe(true)
    expect(describeTab({ kind: "changes" }, {}).closable).toBe(true)
    expect(describeTab({ kind: "terminal", terminalId: "t1" }, {}).closable).toBe(true)
  })
})
