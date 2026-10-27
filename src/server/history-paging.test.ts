import { describe, expect, test } from "bun:test"
import type { ChatHistoryPage, TranscriptEntry } from "../shared/types"
import {
  coalesceContextWindowUpdates,
  decodeHistoryCursor,
  encodeHistoryCursor,
  getHistorySnapshot,
} from "./history-paging"

describe("encodeHistoryCursor", () => {
  test("encodes an index cursor with the idx: prefix", () => {
    expect(encodeHistoryCursor({ kind: "index", index: 0 })).toBe("idx:0")
    expect(encodeHistoryCursor({ kind: "index", index: 42 })).toBe("idx:42")
    expect(encodeHistoryCursor({ kind: "index", index: 9999 })).toBe("idx:9999")
  })

  test("encodes a byte cursor with the byte: prefix", () => {
    expect(encodeHistoryCursor({ kind: "byte", offset: 0 })).toBe("byte:0")
    expect(encodeHistoryCursor({ kind: "byte", offset: 1048576 })).toBe("byte:1048576")
  })
})

describe("decodeHistoryCursor", () => {
  test("round-trips both cursor kinds", () => {
    expect(decodeHistoryCursor(encodeHistoryCursor({ kind: "index", index: 0 }))).toEqual({ kind: "index", index: 0 })
    expect(decodeHistoryCursor(encodeHistoryCursor({ kind: "index", index: 100 }))).toEqual({ kind: "index", index: 100 })
    expect(decodeHistoryCursor(encodeHistoryCursor({ kind: "byte", offset: 4096 }))).toEqual({ kind: "byte", offset: 4096 })
  })

  test("throws on invalid cursors of either kind", () => {
    expect(() => decodeHistoryCursor("cursor:0")).toThrow("Invalid history cursor")
    expect(() => decodeHistoryCursor("")).toThrow("Invalid history cursor")
    expect(() => decodeHistoryCursor("idx:-1")).toThrow("Invalid history cursor")
    expect(() => decodeHistoryCursor("idx:abc")).toThrow("Invalid history cursor")
    expect(() => decodeHistoryCursor("byte:-1")).toThrow("Invalid history cursor")
    expect(() => decodeHistoryCursor("byte:abc")).toThrow("Invalid history cursor")
  })
})

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

describe("getHistorySnapshot", () => {
  test("maps page fields and recentLimit into ChatHistorySnapshot", () => {
    const page: ChatHistoryPage = {
      messages: [],
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
    const page: ChatHistoryPage = { messages: [], hasOlder: false, olderCursor: null }
    expect(getHistorySnapshot(page, 20)).toEqual({
      hasOlder: false,
      olderCursor: null,
      recentLimit: 20,
    })
  })
})
