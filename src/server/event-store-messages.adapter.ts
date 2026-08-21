/**
 * Message and transcript read operations extracted from event-store.ts.
 *
 * `loadTranscriptFromDisk` performs synchronous disk IO, so this module is an
 * adapter (`.adapter.ts`). All other functions in this file are pure in-memory
 * reads — they are co-located here for cohesion because they share the same
 * deps interface and depend on `loadTranscriptFromDisk`.
 *
 * This module must NOT import from event-store.ts (no circular deps).
 */
import path from "node:path"
import type {
  ChatHistoryPage,
  ContextWindowUsageSnapshot,
  QueuedChatMessage,
  TranscriptEntry,
} from "../shared/types"
import { getLatestContextWindowUsage, scanLatestContextWindowUsage } from "./proactive-compact"
import type { StorageBackend } from "./storage/backend"
import type { ToolRequest } from "../shared/permission-policy"
import type { ChatRecord, StoreState } from "./events"
import { cloneTranscriptEntries } from "./events"
import {
  coalesceContextWindowUpdates,
  decodeCursor,
  fitLimitToByteBudget,
  getHistorySnapshot,
  getMessagesPageFromEntries,
  MIN_RECENT_PAGE_ENTRIES,
  RECENT_PAGE_BYTE_BUDGET,
} from "./event-store-helpers"

// ─── Transcript LRU cache ──────────────────────────────────────────────────

/**
 * Small LRU of fully loaded transcripts (Map insertion order = recency).
 * Replaces the former single-chat `cachedTranscriptRef` so switching between
 * a handful of chats does not re-read MB-scale JSONL files from disk.
 */
export function estimateTranscriptBytes(entries: readonly TranscriptEntry[]): number {
  return JSON.stringify(entries).length
}

/**
 * Default budget, counted in SOURCE JSONL bytes rather than heap bytes.
 * Measured amplification from JSONL text to parsed JS objects is ~4.7x, so
 * 24 MiB of transcript costs on the order of 110 MB RSS.
 */
const DEFAULT_TRANSCRIPT_CACHE_MAX_BYTES = 24 * 1024 * 1024

export class TranscriptCache {
  private readonly byChat = new Map<string, TranscriptEntry[]>()
  private readonly bytesByChat = new Map<string, number>()
  private totalBytes = 0

  /**
   * `maxChats` alone was never a memory bound: a transcript has no size limit
   * (the JSONL is never compacted), so "4 chats" measured 220 MB RSS on this
   * install's four largest. Both `maxChats` and `maxBytes` are enforced.
   */
  constructor(
    private readonly maxChats: number = 4,
    private readonly maxBytes: number = DEFAULT_TRANSCRIPT_CACHE_MAX_BYTES,
  ) {}

  /** Returns the cached entries (touching LRU recency), or undefined. */
  get(chatId: string): TranscriptEntry[] | undefined {
    const entries = this.byChat.get(chatId)
    if (!entries) return undefined
    this.byChat.delete(chatId)
    this.byChat.set(chatId, entries)
    return entries
  }

  /**
   * `bytes` is the transcript's source size. Callers holding the file text
   * pass its length for free; the rest fall back to measuring. Transcripts
   * larger than `maxBytes` are never cached: the parsed heap cost (measured
   * ~5x the JSONL size) would exceed the budget regardless of eviction order.
   */
  set(chatId: string, entries: TranscriptEntry[], bytes?: number): void {
    const entryBytes = bytes ?? estimateTranscriptBytes(entries)
    if (entryBytes > this.maxBytes) return
    this.drop(chatId)
    this.byChat.set(chatId, entries)
    this.addBytes(chatId, entryBytes)
    this.evict()
  }

  /** Appends to a cached transcript; no-op when the chat is not cached. */
  appendTo(chatId: string, entry: TranscriptEntry): void {
    const entries = this.byChat.get(chatId)
    if (!entries) return
    entries.push(entry)
    this.addBytes(chatId, estimateTranscriptBytes([entry]))
    this.evict()
  }

  has(chatId: string): boolean {
    return this.byChat.has(chatId)
  }

  invalidate(chatId: string): void {
    this.drop(chatId)
    this.tailByChat.delete(chatId)
  }

  invalidateAll(): void {
    this.byChat.clear()
    this.bytesByChat.clear()
    this.totalBytes = 0
    this.tailByChat.clear()
  }

  private addBytes(chatId: string, bytes: number): void {
    this.bytesByChat.set(chatId, (this.bytesByChat.get(chatId) ?? 0) + bytes)
    this.totalBytes += bytes
  }

  private drop(chatId: string): void {
    if (!this.byChat.delete(chatId)) return
    this.totalBytes -= this.bytesByChat.get(chatId) ?? 0
    this.bytesByChat.delete(chatId)
  }

  private evict(): void {
    while (this.byChat.size > this.maxChats || this.totalBytes > this.maxBytes) {
      const oldest = this.byChat.keys().next().value
      if (oldest === undefined) break
      this.drop(oldest)
    }
  }

  // ─── Tail-window cache ───────────────────────────────────────────────────
  //
  // The full-transcript cache above is only ever seeded when a tail read
  // happens to reach the START of the file, so for any transcript larger than
  // one tail chunk it stays permanently empty — and `getRecentMessagesPage`
  // then takes the tail path on EVERY call, re-reading and re-parsing the file
  // from disk each time (measured: 18.8 ms of a 20.7 ms call at 3k entries).
  // That cost lands on every snapshot derive, i.e. every broadcast tick.
  //
  // Validity is keyed on the transcript's BYTE SIZE, not on invalidation
  // hooks: the JSONL is append-only, so a byte size that has not moved
  // guarantees the tail has not moved. A stat is orders of magnitude cheaper
  // than the re-parse it replaces, and an append changes the size, which
  // expires the entry with no wiring to forget.

  private readonly tailByChat = new Map<string, CachedTail>()

  /** Returns the cached tail for this exact (size, limit), or undefined. */
  getTail(chatId: string, fileSize: number, limit: number): TranscriptTailResult | undefined {
    const hit = this.tailByChat.get(chatId)
    if (!hit || hit.fileSize !== fileSize || hit.limit !== limit) return undefined
    return hit.tail
  }

  /**
   * Drops only the tail window, keeping any full transcript cached.
   * For a writer that REPLACES a transcript wholesale: size-keyed validity
   * assumes append-only, and a rewrite can in principle land on the same byte
   * size with different content.
   */
  invalidateTail(chatId: string): void {
    this.tailByChat.delete(chatId)
  }

  setTail(chatId: string, fileSize: number, limit: number, tail: TranscriptTailResult): void {
    this.tailByChat.delete(chatId)
    this.tailByChat.set(chatId, { fileSize, limit, tail })
    while (this.tailByChat.size > this.maxChats) {
      const oldest = this.tailByChat.keys().next().value
      if (oldest === undefined) break
      this.tailByChat.delete(oldest)
    }
  }
}

interface CachedTail {
  fileSize: number
  limit: number
  tail: TranscriptTailResult
}

// ─── Deps interface ────────────────────────────────────────────────────────

export interface MessageReadDeps {
  readonly storage: StorageBackend
  readonly transcriptsDir: string
  readonly transcriptCache: TranscriptCache
  readonly legacyMessagesByChatId: Map<string, TranscriptEntry[]>
  readonly seenMessageIdsByChatId: Map<string, Set<string>>
  readonly queuedMessagesByChatId: StoreState["queuedMessagesByChatId"]
  readonly chatsById: Map<string, ChatRecord>
  listPendingToolRequests: (chatId: string) => ToolRequest[]
}

// ─── Private helpers ───────────────────────────────────────────────────────

function transcriptPath(deps: MessageReadDeps, chatId: string): string {
  return path.join(deps.transcriptsDir, `${chatId}.jsonl`)
}

// ─── Tail-read fast path ───────────────────────────────────────────────────

const TAIL_CHUNK_BYTES = 256 * 1024
const NEWLINE = 0x0a
const utf8Decoder = new TextDecoder()

export interface TranscriptTailResult {
  entries: TranscriptEntry[]
  /** Absolute byte offset of each entry's raw JSONL line, parallel to `entries`. */
  lineOffsets: number[]
  /** True when the slice covered the start of the file (entries are complete up to the end offset). */
  reachedStart: boolean
}

function parseJsonlSlice(
  buf: Uint8Array,
  sliceStart: number,
  atStart: boolean,
): { entries: TranscriptEntry[]; lineOffsets: number[] } {
  const entries: TranscriptEntry[] = []
  const lineOffsets: number[] = []
  let lineStart = 0
  let skippedPartialFirstLine = atStart
  for (let i = 0; i <= buf.length; i += 1) {
    const atEnd = i === buf.length
    if (!atEnd && buf[i] !== NEWLINE) continue
    if (!skippedPartialFirstLine) {
      // The slice may begin mid-line; the first segment is untrustworthy.
      skippedPartialFirstLine = true
      lineStart = i + 1
      continue
    }
    if (i > lineStart) {
      const text = utf8Decoder.decode(buf.subarray(lineStart, i)).trim()
      if (text) {
        try {
          const entry: TranscriptEntry = JSON.parse(text)
          entries.push(entry)
          lineOffsets.push(sliceStart + lineStart)
        } catch {
          // torn/partial final line — skip
        }
      }
    }
    lineStart = i + 1
  }
  return { entries, lineOffsets }
}

/**
 * Extra bytes read beyond `byteBudget` before the growth loop stops, so the
 * slice reliably holds a full budget's worth of entries once serialized.
 */
const TAIL_BUDGET_MARGIN = 1.25

/**
 * Reads only the tail of the transcript JSONL (growing backwards until more
 * than `minEntries` lines, or `byteBudget` worth of bytes, or BOF). Returns
 * null when the storage backend has no byte-slice APIs — callers must fall
 * back to the full-parse path.
 */
export function readTranscriptTail(
  deps: MessageReadDeps,
  chatId: string,
  minEntries: number,
  endOffset?: number,
  chunkBytes: number = TAIL_CHUNK_BYTES,
  byteBudget?: number,
): TranscriptTailResult | null {
  const { storage } = deps
  if (typeof storage.readSliceSync !== "function" || typeof storage.sizeSync !== "function") {
    return null
  }
  const tPath = transcriptPath(deps, chatId)
  if (!storage.existsSync(tPath)) {
    return { entries: [], lineOffsets: [], reachedStart: true }
  }
  const fileSize = storage.sizeSync(tPath)
  const end = Math.min(endOffset ?? fileSize, fileSize)
  if (end <= 0) {
    return { entries: [], lineOffsets: [], reachedStart: true }
  }
  // Each growth step re-reads and re-parses the whole slice, so the loop costs
  // the SUM of every attempt: chasing 200 fat entries walks 256K→512K→1M→2M→4M
  // and parses ~7.75 MB to build a page the byte budget then trims to 1 MB.
  // When a budget is in play, stop as soon as the slice can fill it — every
  // entry past that point is parsed only to be discarded.
  const budgetBytes = byteBudget === undefined ? undefined : byteBudget * TAIL_BUDGET_MARGIN
  let chunk = Math.max(chunkBytes, 64)
  for (;;) {
    const start = Math.max(0, end - chunk)
    const buf = storage.readSliceSync(tPath, start, end)
    const parsed = parseJsonlSlice(buf, start, start === 0)
    const budgetSatisfied =
      budgetBytes !== undefined &&
      end - start >= budgetBytes &&
      parsed.entries.length > MIN_RECENT_PAGE_ENTRIES
    if (start === 0 || parsed.entries.length > minEntries || budgetSatisfied) {
      return { ...parsed, reachedStart: start === 0 }
    }
    chunk *= 2
  }
}

function decodeByteCursor(cursor: string): number | null {
  if (!cursor.startsWith("byte:")) return null
  const value = Number.parseInt(cursor.slice("byte:".length), 10)
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Invalid history cursor")
  }
  return value
}

/** Caches a COMPLETE transcript and seeds the messageId dedup set. */
function seedFullTranscript(deps: MessageReadDeps, chatId: string, entries: TranscriptEntry[]): void {
  const seen = getSeenMessageIds(deps, chatId)
  for (const entry of entries) {
    const mid = entry.messageId
    if (typeof mid === "string" && mid.length > 0) {
      seen.add(mid)
    }
  }
  deps.transcriptCache.set(chatId, entries)
}

/**
 * Parses the single JSONL line starting at `offset` (the first entry of the
 * already-served newer page). Used as a coalesce sentinel so a cwu run that
 * straddles the page boundary collapses exactly like the full-array path.
 */
function readEntryAtOffset(deps: MessageReadDeps, chatId: string, offset: number): TranscriptEntry | null {
  const { storage } = deps
  if (typeof storage.readSliceSync !== "function" || typeof storage.sizeSync !== "function") return null
  const tPath = transcriptPath(deps, chatId)
  const fileSize = storage.sizeSync(tPath)
  const end = Math.min(offset + 1024 * 1024, fileSize)
  const buf = storage.readSliceSync(tPath, offset, end)
  const newlineIdx = buf.indexOf(NEWLINE)
  if (newlineIdx < 0 && end < fileSize) return null
  const lineEnd = newlineIdx < 0 ? buf.length : newlineIdx
  try {
    const entry: TranscriptEntry = JSON.parse(utf8Decoder.decode(buf.subarray(0, lineEnd)))
    return entry
  } catch {
    return null
  }
}

function pageFromTail(
  tail: TranscriptTailResult,
  limit: number,
  nextEntry?: TranscriptEntry | null,
  byteBudget?: number,
): ChatHistoryPage {
  // The sentinel participates in coalescing (so a trailing cwu run collapses
  // against the newer page's leading cwu) and is then removed.
  const coalesced = nextEntry
    ? coalesceContextWindowUpdates([...tail.entries, nextEntry]).slice(0, -1)
    : coalesceContextWindowUpdates(tail.entries)
  // Callers that pass a budget bound the page by bytes as well as by count;
  // hasOlder / olderCursor below derive from the trimmed page, so the entries
  // dropped here stay reachable through normal scrollback paging.
  const effectiveLimit =
    byteBudget === undefined ? limit : fitLimitToByteBudget(coalesced, limit, byteBudget)
  const startIdx = Math.max(0, coalesced.length - effectiveLimit)
  const pageEntries = coalesced.slice(startIdx)
  const hasOlder = !tail.reachedStart || startIdx > 0
  let olderCursor: string | null = null
  const first = pageEntries[0]
  if (hasOlder && first) {
    const rawIdx = tail.entries.indexOf(first)
    const offset = tail.lineOffsets[rawIdx]
    olderCursor = offset === undefined ? null : `byte:${offset}`
  } else if (hasOlder && tail.lineOffsets.length > 0) {
    // Page fully absorbed by coalescing (pure cwu run) — continue paging
    // from the start of this slice so pagination cannot stall.
    olderCursor = `byte:${tail.lineOffsets[0]}`
  }
  return {
    messages: cloneTranscriptEntries(pageEntries),
    hasOlder,
    olderCursor,
  }
}

/**
 * Serves the most recent page via tail-read, avoiding a full-file parse on
 * cold open. When the tail turns out to be the whole file, the transcript is
 * promoted into the cache (with seen-messageId seeding). Returns null when
 * the backend lacks slice APIs.
 */
export function getRecentMessagesPageTail(
  deps: MessageReadDeps,
  chatId: string,
  limit: number,
  chunkBytes?: number,
): ChatHistoryPage | null {
  // An append-only JSONL at an unchanged byte size has an unchanged tail, so a
  // stat is a sound validity check for the parsed window — and replaces a full
  // re-read + JSON.parse on every snapshot derive.
  const { storage } = deps
  const fileSize =
    typeof storage.sizeSync === "function" && storage.existsSync(transcriptPath(deps, chatId))
      ? storage.sizeSync(transcriptPath(deps, chatId))
      : null

  const cached = fileSize === null ? undefined : deps.transcriptCache.getTail(chatId, fileSize, limit)
  const tail =
    cached ?? readTranscriptTail(deps, chatId, limit, undefined, chunkBytes, RECENT_PAGE_BYTE_BUDGET)
  if (!tail) return null
  if (!cached && fileSize !== null) {
    deps.transcriptCache.setTail(chatId, fileSize, limit, tail)
  }
  if (tail.reachedStart) {
    seedFullTranscript(deps, chatId, tail.entries)
  }
  return pageFromTail(tail, limit, undefined, RECENT_PAGE_BYTE_BUDGET)
}

// ─── Proactive-compact trigger read ────────────────────────────────────────

/**
 * Window sizes for the usage scan. Deliberately smaller than the page tail's
 * 256 KiB: the answer is almost always in the last turn's entries, and the
 * cost that matters is the common case, not the outlier.
 */
const USAGE_SCAN_MIN_ENTRIES = 32
const USAGE_SCAN_FIRST_CHUNK_BYTES = 64 * 1024
const USAGE_SCAN_GROWTH = 8
const USAGE_SCAN_MAX_CHUNK_BYTES = 1024 * 1024

/**
 * How far back from EOF the scan will look before giving up and reporting "no
 * current usage data".
 *
 * This bound is what keeps the scan cheap on a transcript that holds NO marker
 * at all — MEASURED as 241 of 264 chats on the reference install, because
 * imported and PTY-driver sessions never emit `context_window_updated`. Without
 * it those chats re-reads their whole history on every send, which is the cost
 * this read exists to remove.
 *
 * 8 MiB is far more than one turn of entries, and one turn is as far as a
 * CURRENT marker can be: `context_window_updated` is emitted on every turn
 * result. A marker further back than this describes a context window that has
 * since been entirely replaced, so acting on it would be wrong anyway — the
 * conservative `null` (no proactive compact) is the better answer.
 */
const USAGE_SCAN_MAX_LOOKBACK_BYTES = 8 * 1024 * 1024

/**
 * Latest context-window usage for a chat, read from the transcript TAIL.
 *
 * `shouldInjectProactiveCompact` runs on every send and needs only the newest
 * `context_window_updated` / `compact_boundary`. Answering it via `getMessages`
 * parsed the whole transcript — MEASURED at 524 MB peak RSS on a 96 MB / 36k
 * entry chat, on every message. This reads backwards a window at a time and
 * stops at the first marker.
 *
 * Within `USAGE_SCAN_MAX_LOOKBACK_BYTES` of EOF the result is identical to a
 * full backward scan: the loop ends only when the scan is CONCLUSIVE (a marker
 * was hit) or when the window reached the start of the file. Past that bound it
 * reports `null` rather than keep reading — see the constant for why a marker
 * that far back cannot describe the current context window.
 */
export function getLatestChatContextWindowUsage(
  deps: MessageReadDeps,
  chatId: string,
): ContextWindowUsageSnapshot | null {
  // Already in memory: the scan is free. The legacy map matters beyond speed —
  // those chats have no file on disk at all, so a tail read would see an empty
  // transcript and wrongly report no usage.
  if (deps.transcriptCache.has(chatId) || deps.legacyMessagesByChatId.has(chatId)) {
    return getLatestContextWindowUsage(getMessagesView(deps, chatId))
  }

  // Walk backwards in NON-OVERLAPPING windows. Re-reading from EOF with an
  // ever-growing window instead re-parses everything already seen, so a
  // transcript holding no marker costs ~2x a flat read — measured slower AND
  // heavier than the whole-file load this replaces.
  const fileSize = deps.storage.sizeSync?.(transcriptPath(deps, chatId)) ?? 0
  let windowEnd = fileSize
  let chunkBytes = USAGE_SCAN_FIRST_CHUNK_BYTES
  for (;;) {
    // No byteBudget: a budget makes readTranscriptTail stop early and hand back
    // an inconclusive window we would only have to read again. For the same
    // reason this does not consult getTail/setTail — that cache is keyed on
    // (fileSize, limit) and its entries were produced WITH the page byte
    // budget, so a matching limit would serve a truncated window to this
    // unbudgeted query.
    const tail = readTranscriptTail(deps, chatId, USAGE_SCAN_MIN_ENTRIES, windowEnd, chunkBytes)
    if (!tail) break

    // Raw entries, never coalesced — coalescing is a live-window concern.
    const scan = scanLatestContextWindowUsage(tail.entries)
    if (scan.found) return scan.usage
    if (tail.reachedStart) return null

    // The next window ends where this one's first COMPLETE line began, so the
    // torn leading line is picked up by that window and no byte is read twice.
    const nextEnd = tail.lineOffsets[0]
    if (nextEnd === undefined || nextEnd <= 0) return null

    windowEnd = nextEnd
    if (fileSize - windowEnd >= USAGE_SCAN_MAX_LOOKBACK_BYTES) return null
    chunkBytes = Math.min(chunkBytes * USAGE_SCAN_GROWTH, USAGE_SCAN_MAX_CHUNK_BYTES)
  }

  // Backend without byte-slice APIs — behave exactly as before. Unlike the page
  // tail this never calls seedFullTranscript on reachedStart: promoting the
  // transcript into the cache would re-introduce the memory this read avoids.
  return getLatestContextWindowUsage(getMessagesView(deps, chatId))
}

// ─── Exported functions ────────────────────────────────────────────────────

/** Returns (or lazily creates) the seen-messageId dedup set for a chat. */
export function getSeenMessageIds(deps: MessageReadDeps, chatId: string): Set<string> {
  let set = deps.seenMessageIdsByChatId.get(chatId)
  if (!set) {
    set = new Set<string>()
    deps.seenMessageIdsByChatId.set(chatId, set)
  }
  return set
}

/**
 * Reads transcript entries from disk synchronously.
 * Populates the seenMessageIds set as a side-effect.
 */
export function loadTranscriptFromDisk(
  deps: MessageReadDeps,
  chatId: string,
): TranscriptEntry[] {
  return loadTranscriptWithBytes(deps, chatId).entries
}

/**
 * Same load, also reporting the source byte size the cache budgets on — free
 * here (the text is already in hand), and far cheaper than re-measuring the
 * parsed entries.
 */
export function loadTranscriptWithBytes(
  deps: MessageReadDeps,
  chatId: string,
): { entries: TranscriptEntry[]; bytes: number } {
  const tPath = transcriptPath(deps, chatId)
  if (!deps.storage.existsSync(tPath)) {
    return { entries: [], bytes: 0 }
  }

  const text = deps.storage.readTextSync(tPath)
  if (!text.trim()) return { entries: [], bytes: 0 }

  const entries: TranscriptEntry[] = []
  const seen = getSeenMessageIds(deps, chatId)
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim()
    if (!line) continue
    const entry: TranscriptEntry & { messageId?: string } = JSON.parse(line)
    entries.push(entry)
    const mid = entry.messageId
    if (typeof mid === "string" && mid.length > 0) {
      seen.add(mid)
    }
  }
  return { entries, bytes: text.length }
}

/**
 * Returns the cached transcript WITHOUT cloning (loads it on miss).
 * Do-not-mutate contract: callers must treat the array and its entries as
 * read-only; anything returned to mutation-prone callers must be cloned.
 */
export function getMessagesView(deps: MessageReadDeps, chatId: string): readonly TranscriptEntry[] {
  const cached = deps.transcriptCache.get(chatId)
  if (cached) return cached

  const legacyEntries = deps.legacyMessagesByChatId.get(chatId)
  if (legacyEntries) {
    const copy = cloneTranscriptEntries(legacyEntries)
    deps.transcriptCache.set(chatId, copy)
    return copy
  }

  const { entries, bytes } = loadTranscriptWithBytes(deps, chatId)
  deps.transcriptCache.set(chatId, entries, bytes)
  return entries
}

/**
 * Returns cloned transcript entries for `chatId`, using the in-memory cache
 * or loading from disk as needed.
 */
export function getMessages(deps: MessageReadDeps, chatId: string): TranscriptEntry[] {
  return cloneTranscriptEntries(getMessagesView(deps, chatId))
}

/** Returns queued messages for a chat, with attachment arrays cloned. */
export function getQueuedMessages(
  deps: MessageReadDeps,
  chatId: string,
): QueuedChatMessage[] {
  const entries = deps.queuedMessagesByChatId.get(chatId) ?? []
  return entries.map((entry) => ({
    ...entry,
    attachments: [...entry.attachments],
  }))
}

/** Returns a single queued message by id, or null. */
export function getQueuedMessage(
  deps: MessageReadDeps,
  chatId: string,
  queuedMessageId: string,
): QueuedChatMessage | null {
  return getQueuedMessages(deps, chatId).find((entry) => entry.id === queuedMessageId) ?? null
}

/** Returns the most recent page of transcript messages. */
export function getRecentMessagesPage(
  deps: MessageReadDeps,
  chatId: string,
  limit: number,
): ChatHistoryPage {
  if (limit <= 0) {
    return { messages: [], hasOlder: false, olderCursor: null }
  }

  if (!deps.transcriptCache.has(chatId) && !deps.legacyMessagesByChatId.has(chatId)) {
    const tailPage = getRecentMessagesPageTail(deps, chatId, limit)
    if (tailPage) return tailPage
  }

  const entries = coalesceContextWindowUpdates(getMessagesView(deps, chatId))
  const page = getMessagesPageFromEntries(entries, fitLimitToByteBudget(entries, limit))

  return {
    messages: page.entries,
    hasOlder: page.hasOlder,
    olderCursor: page.olderCursor,
  }
}

/** Returns a page of transcript messages before the given cursor. */
export function getMessagesPageBefore(
  deps: MessageReadDeps,
  chatId: string,
  beforeCursor: string,
  limit: number,
): ChatHistoryPage {
  if (limit <= 0) {
    return { messages: [], hasOlder: false, olderCursor: null }
  }

  // Byte cursors are only ever issued by the tail-read path, whose storage
  // has slice APIs — so readTranscriptTail cannot return null here.
  const byteOffset = decodeByteCursor(beforeCursor)
  if (byteOffset !== null) {
    const tail = readTranscriptTail(deps, chatId, limit, byteOffset)
    if (!tail) throw new Error("Invalid history cursor")
    return pageFromTail(tail, limit, readEntryAtOffset(deps, chatId, byteOffset))
  }

  // Coalesce identically to getRecentMessagesPage so cursors (which index the
  // coalesced array) stay consistent across recent + load-older paging.
  const beforeIndex = decodeCursor(beforeCursor)
  const entries = coalesceContextWindowUpdates(getMessagesView(deps, chatId))
  const page = getMessagesPageFromEntries(entries, limit, beforeIndex)

  return {
    messages: page.entries,
    hasOlder: page.hasOlder,
    olderCursor: page.olderCursor,
  }
}

/** Returns merged transcript + pending tool request entries, plus a history snapshot. */
export function getRecentChatHistory(
  deps: MessageReadDeps,
  chatId: string,
  recentLimit: number,
) {
  const page = getRecentMessagesPage(deps, chatId, recentLimit)
  const pending = deps.listPendingToolRequests(chatId)
  const pendingEntries: TranscriptEntry[] = pending.map((req) => ({
    _id: `pending-tool-request-${req.id}`,
    createdAt: req.createdAt,
    kind: "pending_tool_request",
    toolRequestId: req.id,
    toolName: req.toolName,
    arguments: req.arguments,
  }))
  const merged = [...page.messages, ...pendingEntries]
  return {
    messages: merged,
    history: getHistorySnapshot(
      {
        entries: merged,
        hasOlder: page.hasOlder,
        olderCursor: page.olderCursor,
      },
      recentLimit,
    ),
  }
}

/** Returns the count of active (non-deleted, non-archived) chats for a project. */
export function getChatCount(deps: MessageReadDeps, projectId: string): number {
  return [...deps.chatsById.values()].filter(
    (chat) => chat.projectId === projectId && !chat.deletedAt && !chat.archivedAt,
  ).length
}
