import { describe, expect, test } from "bun:test"
import type { PaneTab } from "../../lib/paneTree"
import {
  DEFAULT_RETENTION_CAP,
  noteTabActivated,
  selectRetainedTabIds,
} from "./paneRetention"

function targetFor(tabId: string, kind: "chat" | "changes" | "terminal"): PaneTab["target"] {
  if (kind === "terminal") return { kind, terminalId: tabId }
  if (kind === "chat") return { kind, chatId: tabId }
  return { kind }
}

function tab(tabId: string, kind: "chat" | "changes" | "terminal"): PaneTab {
  return { tabId, target: targetFor(tabId, kind), createdAt: 0 }
}

describe("selectRetainedTabIds", () => {
  test("retains the active tab even when the cap leaves no room for anything else", () => {
    const tabs = [tab("chat", "chat"), tab("changes", "changes")]

    expect(selectRetainedTabIds({ tabs, activeTabId: "chat", recency: [], cap: 0 })).toEqual([
      "chat",
    ])
  })

  test("retains nothing when no tab is active and the cap is zero", () => {
    const tabs = [tab("chat", "chat")]

    expect(selectRetainedTabIds({ tabs, activeTabId: null, recency: [], cap: 0 })).toEqual([])
  })

  test("retains every terminal tab regardless of recency or cap", () => {
    // A terminal holds a live PTY and its scrollback; unmounting one destroys
    // state the server cannot replay. Tier 2 is uncapped for exactly this.
    const tabs = [
      tab("chat", "chat"),
      tab("t1", "terminal"),
      tab("t2", "terminal"),
      tab("t3", "terminal"),
      tab("t4", "terminal"),
    ]

    const retained = selectRetainedTabIds({
      tabs,
      activeTabId: "chat",
      recency: [],
      cap: 0,
    })

    expect(retained).toEqual(["chat", "t1", "t2", "t3", "t4"])
  })

  test("caps non-terminal tabs by recency, most recent first", () => {
    const tabs = [tab("a", "chat"), tab("b", "changes"), tab("c", "chat"), tab("d", "changes")]

    const retained = selectRetainedTabIds({
      tabs,
      activeTabId: "a",
      recency: ["d", "c", "b"],
      cap: 2,
    })

    // active "a" (tier 1) + the two most recent of b/c/d → d, c. "b" is evicted.
    expect(retained).toEqual(["a", "c", "d"])
  })

  test("returns retained ids in tab order, not recency order", () => {
    // Render order must follow the tab strip so React children stay positionally
    // stable; a recency-ordered result would reorder the DOM on every switch.
    const tabs = [tab("a", "chat"), tab("b", "changes"), tab("c", "chat")]

    const retained = selectRetainedTabIds({
      tabs,
      activeTabId: "c",
      recency: ["b", "a"],
      cap: 3,
    })

    expect(retained).toEqual(["a", "b", "c"])
  })

  test("ignores recency entries for tabs that no longer exist", () => {
    const tabs = [tab("a", "chat")]

    const retained = selectRetainedTabIds({
      tabs,
      activeTabId: "a",
      recency: ["ghost", "gone"],
      cap: 3,
    })

    expect(retained).toEqual(["a"])
  })

  test("never emits an active id that is not among the tabs", () => {
    const tabs = [tab("a", "chat")]

    const retained = selectRetainedTabIds({ tabs, activeTabId: "stale", recency: [], cap: 3 })

    expect(retained).not.toContain("stale")
    expect(selectRetainedTabIds({ tabs, activeTabId: "stale", recency: [], cap: 0 })).toEqual([])
  })

  test("does not double-count the active tab against the cap", () => {
    const tabs = [tab("a", "chat"), tab("b", "changes"), tab("c", "chat")]

    const retained = selectRetainedTabIds({
      tabs,
      activeTabId: "a",
      recency: ["a", "b", "c"],
      cap: 2,
    })

    // "a" is tier 1; the cap applies to b and c only, so both survive.
    expect(retained).toEqual(["a", "b", "c"])
  })

  test("falls back to tab order for tabs absent from the recency list", () => {
    const tabs = [tab("a", "chat"), tab("b", "changes"), tab("c", "chat")]

    const retained = selectRetainedTabIds({
      tabs,
      activeTabId: null,
      recency: [],
      cap: 2,
    })

    expect(retained).toEqual(["a", "b"])
  })

  test("defaults to the documented cap", () => {
    expect(DEFAULT_RETENTION_CAP).toBe(3)

    const tabs = Array.from({ length: 6 }, (_, i) => tab(`t${i}`, "chat"))
    const retained = selectRetainedTabIds({ tabs, activeTabId: null, recency: [] })

    expect(retained).toHaveLength(DEFAULT_RETENTION_CAP)
  })

  test("is stable: the same input yields an equal result", () => {
    const tabs = [tab("a", "chat"), tab("b", "terminal"), tab("c", "changes")]
    const input = { tabs, activeTabId: "a", recency: ["c"], cap: 1 }

    expect(selectRetainedTabIds(input)).toEqual(selectRetainedTabIds(input))
  })
})

describe("noteTabActivated", () => {
  test("puts the activated tab first", () => {
    expect(noteTabActivated(["b", "c"], "a")).toEqual(["a", "b", "c"])
  })

  test("moves an already-known tab to the front without duplicating it", () => {
    expect(noteTabActivated(["b", "a", "c"], "a")).toEqual(["a", "b", "c"])
  })

  test("returns the same reference when the tab is already most recent", () => {
    // Reference stability matters: this feeds a store write, and a fresh array
    // on every activation would publish a new snapshot for a no-op.
    const recency = ["a", "b"]

    expect(noteTabActivated(recency, "a")).toBe(recency)
  })

  test("bounds the list so a long session cannot grow it without limit", () => {
    const recency = Array.from({ length: 64 }, (_, i) => `t${i}`)

    expect(noteTabActivated(recency, "new", 8)).toHaveLength(8)
    expect(noteTabActivated(recency, "new", 8)[0]).toBe("new")
  })
})
