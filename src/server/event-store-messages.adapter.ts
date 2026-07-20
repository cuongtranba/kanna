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
import type { ChatHistoryPage, QueuedChatMessage, TranscriptEntry } from "../shared/types"
import type { StorageBackend } from "./storage/backend"
import type { ToolRequest } from "../shared/permission-policy"
import type { ChatRecord, StoreState } from "./events"
import { cloneTranscriptEntries } from "./events"
import {
  coalesceContextWindowUpdates,
  decodeCursor,
  getHistorySnapshot,
  getMessagesPageFromEntries,
} from "./event-store-helpers"

// ─── Transcript LRU cache ──────────────────────────────────────────────────

/**
 * Small LRU of fully loaded transcripts (Map insertion order = recency).
 * Replaces the former single-chat `cachedTranscriptRef` so switching between
 * a handful of chats does not re-read MB-scale JSONL files from disk.
 */
export class TranscriptCache {
  private readonly byChat = new Map<string, TranscriptEntry[]>()

  constructor(private readonly maxChats: number = 4) {}

  /** Returns the cached entries (touching LRU recency), or undefined. */
  get(chatId: string): TranscriptEntry[] | undefined {
    const entries = this.byChat.get(chatId)
    if (!entries) return undefined
    this.byChat.delete(chatId)
    this.byChat.set(chatId, entries)
    return entries
  }

  set(chatId: string, entries: TranscriptEntry[]): void {
    this.byChat.delete(chatId)
    this.byChat.set(chatId, entries)
    while (this.byChat.size > this.maxChats) {
      const oldest = this.byChat.keys().next().value
      if (oldest === undefined) break
      this.byChat.delete(oldest)
    }
  }

  /** Appends to a cached transcript; no-op when the chat is not cached. */
  appendTo(chatId: string, entry: TranscriptEntry): void {
    this.byChat.get(chatId)?.push(entry)
  }

  has(chatId: string): boolean {
    return this.byChat.has(chatId)
  }

  invalidate(chatId: string): void {
    this.byChat.delete(chatId)
  }

  invalidateAll(): void {
    this.byChat.clear()
  }
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
 * Reads only the tail of the transcript JSONL (growing backwards until more
 * than `minEntries` lines or BOF). Returns null when the storage backend has
 * no byte-slice APIs — callers must fall back to the full-parse path.
 */
export function readTranscriptTail(
  deps: MessageReadDeps,
  chatId: string,
  minEntries: number,
  endOffset?: number,
  chunkBytes: number = TAIL_CHUNK_BYTES,
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
  let chunk = Math.max(chunkBytes, 64)
  for (;;) {
    const start = Math.max(0, end - chunk)
    const buf = storage.readSliceSync(tPath, start, end)
    const parsed = parseJsonlSlice(buf, start, start === 0)
    if (start === 0 || parsed.entries.length > minEntries) {
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

function pageFromTail(tail: TranscriptTailResult, limit: number, nextEntry?: TranscriptEntry | null): ChatHistoryPage {
  // The sentinel participates in coalescing (so a trailing cwu run collapses
  // against the newer page's leading cwu) and is then removed.
  const coalesced = nextEntry
    ? coalesceContextWindowUpdates([...tail.entries, nextEntry]).slice(0, -1)
    : coalesceContextWindowUpdates(tail.entries)
  const startIdx = Math.max(0, coalesced.length - limit)
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
  const tail = readTranscriptTail(deps, chatId, limit, undefined, chunkBytes)
  if (!tail) return null
  if (tail.reachedStart) {
    seedFullTranscript(deps, chatId, tail.entries)
  }
  return pageFromTail(tail, limit)
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
  const tPath = transcriptPath(deps, chatId)
  if (!deps.storage.existsSync(tPath)) {
    return []
  }

  const text = deps.storage.readTextSync(tPath)
  if (!text.trim()) return []

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
  return entries
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

  const entries = loadTranscriptFromDisk(deps, chatId)
  deps.transcriptCache.set(chatId, entries)
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
  const page = getMessagesPageFromEntries(entries, limit)

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
