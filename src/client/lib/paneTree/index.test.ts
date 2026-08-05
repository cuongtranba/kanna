import { describe, expect, test } from "bun:test"

import {
  closePane,
  nextPane,
  openPane,
  prevPane,
  selectPane,
  type PaneTree,
} from "./index"

// ---------------------------------------------------------------------------
// openPane — open & dedup
// ---------------------------------------------------------------------------
describe("openPane", () => {
  test("opens first pane into an empty tree", () => {
    const empty: PaneTree = { panes: [], activeIndex: 0 }
    const tree = openPane(empty, "chat-a")
    expect(tree.panes).toHaveLength(1)
    expect(tree.panes[0]?.chatId).toBe("chat-a")
    expect(tree.activeIndex).toBe(0)
  })

  test("appends a second pane and makes it active", () => {
    const start: PaneTree = { panes: [{ chatId: "a" }], activeIndex: 0 }
    const tree = openPane(start, "b")
    expect(tree.panes).toHaveLength(2)
    expect(tree.activeIndex).toBe(1)
  })

  test("dedup: returns same reference when chatId already open", () => {
    const start: PaneTree = { panes: [{ chatId: "a" }, { chatId: "b" }], activeIndex: 1 }
    const result = openPane(start, "a")
    expect(result).toBe(start)
  })
})

// ---------------------------------------------------------------------------
// closePane — removal + nearest-neighbour selection
// ---------------------------------------------------------------------------
describe("closePane", () => {
  test("close last pane → empty tree with activeIndex 0", () => {
    const tree: PaneTree = { panes: [{ chatId: "a" }], activeIndex: 0 }
    const result = closePane(tree, "a")
    expect(result.panes).toHaveLength(0)
    expect(result.activeIndex).toBe(0)
  })

  test("close active pane with a prev sibling → selects prev", () => {
    // [a, b, c] activeIndex=1 → close b → [a, c] activeIndex=0
    const tree: PaneTree = {
      panes: [{ chatId: "a" }, { chatId: "b" }, { chatId: "c" }],
      activeIndex: 1,
    }
    const result = closePane(tree, "b")
    expect(result.panes.map((p) => p.chatId)).toEqual(["a", "c"])
    expect(result.activeIndex).toBe(0) // prev pane (a)
  })

  test("close active first pane → selects next (same index 0)", () => {
    // [a, b] activeIndex=0 → close a → [b] activeIndex=0
    const tree: PaneTree = { panes: [{ chatId: "a" }, { chatId: "b" }], activeIndex: 0 }
    const result = closePane(tree, "a")
    expect(result.panes.map((p) => p.chatId)).toEqual(["b"])
    expect(result.activeIndex).toBe(0) // b is now at index 0
  })

  test("close a pane before the active one → shifts activeIndex left", () => {
    // [a, b, c] activeIndex=2 → close a → [b, c] activeIndex=1
    const tree: PaneTree = {
      panes: [{ chatId: "a" }, { chatId: "b" }, { chatId: "c" }],
      activeIndex: 2,
    }
    const result = closePane(tree, "a")
    expect(result.panes.map((p) => p.chatId)).toEqual(["b", "c"])
    expect(result.activeIndex).toBe(1) // still points to c
  })

  test("close a pane after the active one → activeIndex unchanged", () => {
    // [a, b, c] activeIndex=0 → close c → [a, b] activeIndex=0
    const tree: PaneTree = {
      panes: [{ chatId: "a" }, { chatId: "b" }, { chatId: "c" }],
      activeIndex: 0,
    }
    const result = closePane(tree, "c")
    expect(result.panes.map((p) => p.chatId)).toEqual(["a", "b"])
    expect(result.activeIndex).toBe(0)
  })

  test("no-op when chatId not found", () => {
    const tree: PaneTree = { panes: [{ chatId: "a" }], activeIndex: 0 }
    expect(closePane(tree, "missing")).toBe(tree)
  })
})

// ---------------------------------------------------------------------------
// selectPane
// ---------------------------------------------------------------------------
describe("selectPane", () => {
  test("selects an existing pane by chatId", () => {
    const tree: PaneTree = {
      panes: [{ chatId: "a" }, { chatId: "b" }],
      activeIndex: 0,
    }
    const result = selectPane(tree, "b")
    expect(result.activeIndex).toBe(1)
  })

  test("no-op when already active", () => {
    const tree: PaneTree = { panes: [{ chatId: "a" }], activeIndex: 0 }
    expect(selectPane(tree, "a")).toBe(tree)
  })

  test("no-op when chatId not found", () => {
    const tree: PaneTree = { panes: [{ chatId: "a" }], activeIndex: 0 }
    expect(selectPane(tree, "missing")).toBe(tree)
  })
})

// ---------------------------------------------------------------------------
// nextPane / prevPane — keyboard wrap-around
// ---------------------------------------------------------------------------
describe("nextPane", () => {
  test("advances to next pane", () => {
    const tree: PaneTree = {
      panes: [{ chatId: "a" }, { chatId: "b" }, { chatId: "c" }],
      activeIndex: 0,
    }
    expect(nextPane(tree).activeIndex).toBe(1)
  })

  test("wraps from last to first", () => {
    const tree: PaneTree = {
      panes: [{ chatId: "a" }, { chatId: "b" }],
      activeIndex: 1,
    }
    expect(nextPane(tree).activeIndex).toBe(0)
  })

  test("no-op on single pane (returns same reference)", () => {
    const tree: PaneTree = { panes: [{ chatId: "a" }], activeIndex: 0 }
    expect(nextPane(tree)).toBe(tree)
  })
})

describe("prevPane", () => {
  test("moves to previous pane", () => {
    const tree: PaneTree = {
      panes: [{ chatId: "a" }, { chatId: "b" }, { chatId: "c" }],
      activeIndex: 2,
    }
    expect(prevPane(tree).activeIndex).toBe(1)
  })

  test("wraps from first to last", () => {
    const tree: PaneTree = {
      panes: [{ chatId: "a" }, { chatId: "b" }],
      activeIndex: 0,
    }
    expect(prevPane(tree).activeIndex).toBe(1)
  })

  test("no-op on single pane (returns same reference)", () => {
    const tree: PaneTree = { panes: [{ chatId: "a" }], activeIndex: 0 }
    expect(prevPane(tree)).toBe(tree)
  })
})
