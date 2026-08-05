import { describe, expect, test } from "bun:test"
import type { PaneTabTarget } from "../../lib/paneTree"
import { describeTab } from "./tabPresentation"

describe("describeTab", () => {
  test("names the singleton kinds", () => {
    expect(describeTab({ kind: "chat" }, {}).label).toBe("Chat")
    expect(describeTab({ kind: "changes" }, {}).label).toBe("Changes")
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
      { kind: "chat" },
      { kind: "changes" },
      { kind: "terminal", terminalId: "t1" },
    ]
    for (const target of targets) {
      expect(describeTab(target, {}).icon).toBeDefined()
    }
  })

  // A live terminal must not be torn down by the retention LRU, so it declares
  // itself pinned; chat and changes can be remounted cheaply.
  test("marks a running terminal as pinned so retention keeps it mounted", () => {
    const target: PaneTabTarget = { kind: "terminal", terminalId: "t1" }
    expect(describeTab(target, { liveTerminalIds: new Set(["t1"]) }).pinned).toBe(true)
    expect(describeTab(target, { liveTerminalIds: new Set() }).pinned).toBe(false)
    expect(describeTab({ kind: "chat" }, {}).pinned).toBe(false)
  })

  test("chat and changes cannot be closed", () => {
    expect(describeTab({ kind: "chat" }, {}).closable).toBe(false)
    expect(describeTab({ kind: "changes" }, {}).closable).toBe(true)
    expect(describeTab({ kind: "terminal", terminalId: "t1" }, {}).closable).toBe(true)
  })
})
