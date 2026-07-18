import { describe, expect, test } from "bun:test"
import type { TranscriptEntry } from "../shared/types"
import type { StoreEvent } from "./events"
import {
  coalesceContextWindowUpdates,
  decodeCursor,
  encodeHistoryCursor,
  getForkedChatTitle,
  getHistorySnapshot,
  getReplayEventPriority,
  normalizeSidebarProjectOrder,
  slashCommandsEqual,
  type TranscriptPageResult,
} from "./event-store-helpers"

// ---------------------------------------------------------------------------
// normalizeSidebarProjectOrder
// ---------------------------------------------------------------------------
describe("normalizeSidebarProjectOrder", () => {
  test("returns empty array for non-array input", () => {
    expect(normalizeSidebarProjectOrder(null)).toEqual([])
    expect(normalizeSidebarProjectOrder(42)).toEqual([])
    expect(normalizeSidebarProjectOrder({ a: 1 })).toEqual([])
  })

  test("filters out non-string entries", () => {
    expect(normalizeSidebarProjectOrder(["a", 2, null, "b"])).toEqual(["a", "b"])
  })

  test("trims whitespace and skips blank strings", () => {
    expect(normalizeSidebarProjectOrder(["  a  ", "  ", "b"])).toEqual(["a", "b"])
  })

  test("deduplicates preserving first occurrence", () => {
    expect(normalizeSidebarProjectOrder(["x", "y", "x", "z"])).toEqual(["x", "y", "z"])
  })

  test("returns ordered array for clean input", () => {
    expect(normalizeSidebarProjectOrder(["proj-1", "proj-2"])).toEqual(["proj-1", "proj-2"])
  })
})

// ---------------------------------------------------------------------------
// encodeHistoryCursor / decodeCursor
// ---------------------------------------------------------------------------
describe("encodeHistoryCursor", () => {
  test("encodes index as idx: prefix string", () => {
    expect(encodeHistoryCursor(0)).toBe("idx:0")
    expect(encodeHistoryCursor(42)).toBe("idx:42")
    expect(encodeHistoryCursor(9999)).toBe("idx:9999")
  })
})

describe("decodeCursor", () => {
  test("round-trips with encodeHistoryCursor", () => {
    expect(decodeCursor(encodeHistoryCursor(0))).toBe(0)
    expect(decodeCursor(encodeHistoryCursor(100))).toBe(100)
  })

  test("throws on invalid cursor format", () => {
    expect(() => decodeCursor("cursor:0")).toThrow("Invalid history cursor")
    expect(() => decodeCursor("")).toThrow("Invalid history cursor")
    expect(() => decodeCursor("idx:-1")).toThrow("Invalid history cursor")
    expect(() => decodeCursor("idx:abc")).toThrow("Invalid history cursor")
  })
})

// ---------------------------------------------------------------------------
// slashCommandsEqual
// ---------------------------------------------------------------------------
describe("slashCommandsEqual", () => {
  test("returns true for two empty arrays", () => {
    expect(slashCommandsEqual([], [])).toBe(true)
  })

  test("returns false when lengths differ", () => {
    expect(slashCommandsEqual(
      [{ name: "a", description: "d", argumentHint: "" }],
      [],
    )).toBe(false)
  })

  test("returns true for identical arrays", () => {
    const cmds = [{ name: "foo", description: "bar", argumentHint: "<hint>" }]
    expect(slashCommandsEqual(cmds, cmds)).toBe(true)
  })

  test("returns false when a field differs", () => {
    const a = [{ name: "foo", description: "bar", argumentHint: "" }]
    const b = [{ name: "foo", description: "baz", argumentHint: "" }]
    expect(slashCommandsEqual(a, b)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// coalesceContextWindowUpdates
// ---------------------------------------------------------------------------

function makeEntry(kind: TranscriptEntry["kind"], id: string): TranscriptEntry {
  return { _id: id, createdAt: 0, kind } as TranscriptEntry
}

describe("coalesceContextWindowUpdates", () => {
  test("returns empty array unchanged", () => {
    expect(coalesceContextWindowUpdates([])).toEqual([])
  })

  test("passes through entries without context_window_updated", () => {
    const entries = [
      makeEntry("user_prompt", "1"),
      makeEntry("assistant_text", "2"),
    ]
    expect(coalesceContextWindowUpdates(entries)).toEqual(entries)
  })

  test("collapses consecutive context_window_updated to last", () => {
    const entries = [
      makeEntry("context_window_updated", "cwu-1"),
      makeEntry("context_window_updated", "cwu-2"),
      makeEntry("context_window_updated", "cwu-3"),
    ]
    const result = coalesceContextWindowUpdates(entries)
    expect(result).toHaveLength(1)
    expect(result[0]!._id).toBe("cwu-3")
  })

  test("preserves non-cwu entries between cwu runs", () => {
    const entries = [
      makeEntry("context_window_updated", "cwu-1"),
      makeEntry("context_window_updated", "cwu-2"),
      makeEntry("user_prompt", "up-1"),
      makeEntry("context_window_updated", "cwu-3"),
      makeEntry("context_window_updated", "cwu-4"),
    ]
    const result = coalesceContextWindowUpdates(entries)
    expect(result.map((e) => e._id)).toEqual(["cwu-2", "up-1", "cwu-4"])
  })

  test("does not drop a single context_window_updated", () => {
    const entries = [makeEntry("context_window_updated", "solo")]
    expect(coalesceContextWindowUpdates(entries)).toEqual(entries)
  })
})

// ---------------------------------------------------------------------------
// getHistorySnapshot
// ---------------------------------------------------------------------------
describe("getHistorySnapshot", () => {
  test("maps page fields and recentLimit into ChatHistorySnapshot", () => {
    const page: TranscriptPageResult = {
      entries: [],
      hasOlder: true,
      olderCursor: "idx:5",
    }
    expect(getHistorySnapshot(page, 50)).toEqual({
      hasOlder: true,
      olderCursor: "idx:5",
      recentLimit: 50,
    })
  })

  test("passes null olderCursor through", () => {
    const page: TranscriptPageResult = { entries: [], hasOlder: false, olderCursor: null }
    expect(getHistorySnapshot(page, 20)).toEqual({
      hasOlder: false,
      olderCursor: null,
      recentLimit: 20,
    })
  })
})

// ---------------------------------------------------------------------------
// getForkedChatTitle
// ---------------------------------------------------------------------------
describe("getForkedChatTitle", () => {
  test("prefixes non-fork titles", () => {
    expect(getForkedChatTitle("My Chat")).toBe("Fork: My Chat")
  })

  test("does not double-prefix already-forked titles", () => {
    expect(getForkedChatTitle("Fork: My Chat")).toBe("Fork: My Chat")
  })

  test("returns default for empty title", () => {
    expect(getForkedChatTitle("")).toBe("Fork: New Chat")
  })

  test("returns default for whitespace-only title", () => {
    expect(getForkedChatTitle("   ")).toBe("Fork: New Chat")
  })

  test("trims whitespace before prefixing", () => {
    expect(getForkedChatTitle("  Hello  ")).toBe("Fork: Hello")
  })
})

// ---------------------------------------------------------------------------
// getReplayEventPriority — spot-check priority buckets
// ---------------------------------------------------------------------------
describe("getReplayEventPriority", () => {
  function makeEvent(type: string): StoreEvent {
    return { type } as StoreEvent
  }

  test("project events have priority 0", () => {
    expect(getReplayEventPriority(makeEvent("project_opened"))).toBe(0)
    expect(getReplayEventPriority(makeEvent("sidebar_project_order_set"))).toBe(0)
  })

  test("chat_created has priority 1", () => {
    expect(getReplayEventPriority(makeEvent("chat_created"))).toBe(1)
  })

  test("turn_started has priority 5", () => {
    expect(getReplayEventPriority(makeEvent("turn_started"))).toBe(5)
  })

  test("turn_finished has priority 8", () => {
    expect(getReplayEventPriority(makeEvent("turn_finished"))).toBe(8)
  })

  test("loop_armed has priority 11", () => {
    expect(getReplayEventPriority(makeEvent("loop_armed"))).toBe(11)
  })

  test("orch events have priority 5", () => {
    expect(getReplayEventPriority(makeEvent("orch_run_created"))).toBe(5)
    expect(getReplayEventPriority(makeEvent("orch_task_committed"))).toBe(5)
  })
})
