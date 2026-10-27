import type { ChatHistoryPage, ChatHistorySnapshot, TranscriptEntry } from "../shared/types"
import { cloneTranscriptEntries } from "./events"

export type HistoryCursor =
  | { kind: "index"; index: number }
  | { kind: "byte"; offset: number }

const INDEX_PREFIX = "idx:"
const BYTE_PREFIX = "byte:"

export function encodeHistoryCursor(cursor: HistoryCursor): string {
  return cursor.kind === "index" ? `${INDEX_PREFIX}${cursor.index}` : `${BYTE_PREFIX}${cursor.offset}`
}

function parseCursorNumber(text: string): number {
  const value = Number.parseInt(text, 10)
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Invalid history cursor")
  }
  return value
}

export function decodeHistoryCursor(cursor: string): HistoryCursor {
  if (cursor.startsWith(INDEX_PREFIX)) {
    return { kind: "index", index: parseCursorNumber(cursor.slice(INDEX_PREFIX.length)) }
  }
  if (cursor.startsWith(BYTE_PREFIX)) {
    return { kind: "byte", offset: parseCursorNumber(cursor.slice(BYTE_PREFIX.length)) }
  }
  throw new Error("Invalid history cursor")
}

export const RECENT_PAGE_BYTE_BUDGET = 1024 * 1024

export const MIN_RECENT_PAGE_ENTRIES = 10

export function fitLimitToByteBudget(
  entries: readonly TranscriptEntry[],
  limit: number,
  byteBudget: number = RECENT_PAGE_BYTE_BUDGET,
  minEntries: number = MIN_RECENT_PAGE_ENTRIES,
): number {
  if (limit <= 0 || entries.length === 0 || byteBudget <= 0) return limit

  const windowSize = Math.min(limit, entries.length)
  const floor = Math.min(minEntries, windowSize)
  let used = 0
  let kept = 0

  for (let index = entries.length - 1; index >= entries.length - windowSize; index -= 1) {
    const entry = entries[index]
    if (entry === undefined) break
    const size = JSON.stringify(entry).length
    if (kept >= floor && used + size > byteBudget) break
    used += size
    kept += 1
  }

  return kept
}

export function coalesceContextWindowUpdates(entries: readonly TranscriptEntry[]): TranscriptEntry[] {
  const result: TranscriptEntry[] = []
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!
    const next = entries[index + 1]
    if (entry.kind === "context_window_updated" && next?.kind === "context_window_updated") {
      continue
    }
    result.push(entry)
  }
  return result
}

export function getHistorySnapshot(
  page: Pick<ChatHistoryPage, "hasOlder" | "olderCursor">,
  recentLimit: number,
): ChatHistorySnapshot {
  return {
    hasOlder: page.hasOlder,
    olderCursor: page.olderCursor,
    recentLimit,
  }
}

export function getMessagesPageFromEntries(
  entries: TranscriptEntry[],
  limit: number,
  beforeIndex?: number,
): ChatHistoryPage {
  if (entries.length === 0) {
    return { messages: [], hasOlder: false, olderCursor: null }
  }
  const endIndex =
    beforeIndex === undefined
      ? entries.length
      : Math.max(0, Math.min(beforeIndex, entries.length))
  const startIndex = Math.max(0, endIndex - limit)
  return {
    messages: cloneTranscriptEntries(entries.slice(startIndex, endIndex)),
    hasOlder: startIndex > 0,
    olderCursor: startIndex > 0 ? encodeHistoryCursor({ kind: "index", index: startIndex }) : null,
  }
}
