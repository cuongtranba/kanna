import { describe, expect, test } from "bun:test"
import { createPane } from "../../lib/paneTree"
import { renderPaneContent, type PaneContentRegistry } from "./paneContentRegistry"

const pane = createPane("p1")

const registry: PaneContentRegistry = {
  chat: (_t, _p, focused) => `chat-${String(focused)}`,
  changes: (_t, _p, _focused) => "changes",
  terminal: (t, _p, _focused) => `terminal-${t.terminalId}`,
}

describe("renderPaneContent", () => {
  test("dispatches to the chat renderer for a chat target", () => {
    expect(renderPaneContent(registry, { kind: "chat" }, pane, true)).toBe("chat-true")
    expect(renderPaneContent(registry, { kind: "chat" }, pane, false)).toBe("chat-false")
  })

  test("dispatches to the changes renderer", () => {
    expect(renderPaneContent(registry, { kind: "changes" }, pane, false)).toBe("changes")
  })

  test("dispatches to the terminal renderer and passes terminalId", () => {
    expect(
      renderPaneContent(registry, { kind: "terminal", terminalId: "t1" }, pane, false),
    ).toBe("terminal-t1")
    expect(
      renderPaneContent(registry, { kind: "terminal", terminalId: "other" }, pane, false),
    ).toBe("terminal-other")
  })

  test("passes the pane to the renderer", () => {
    const seenIds: string[] = []
    const reg: PaneContentRegistry = {
      chat: (_t, p, _f) => { seenIds.push(p.id); return null },
      changes: (_t, p, _f) => { seenIds.push(p.id); return null },
      terminal: (_t, p, _f) => { seenIds.push(p.id); return null },
    }
    renderPaneContent(reg, { kind: "chat" }, pane, false)
    renderPaneContent(reg, { kind: "changes" }, pane, false)
    renderPaneContent(reg, { kind: "terminal", terminalId: "x" }, pane, false)
    expect(seenIds).toEqual(["p1", "p1", "p1"])
  })

  // The type system enforces this, but verify the runtime dispatch too: each
  // renderer only fires for its own kind.
  test("does not call other renderers when dispatching to chat", () => {
    const called: string[] = []
    const reg: PaneContentRegistry = {
      chat: () => { called.push("chat"); return null },
      changes: () => { called.push("changes"); return null },
      terminal: () => { called.push("terminal"); return null },
    }
    renderPaneContent(reg, { kind: "chat" }, pane, false)
    expect(called).toEqual(["chat"])
  })
})
