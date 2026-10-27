import type {
  ChatHistoryPage,
  ContextWindowUsageSnapshot,
  QueuedChatMessage,
  TranscriptEntry,
} from "../shared/types"
import { scanLatestContextWindowUsage } from "./proactive-compact"
import type { StorageBackend } from "./storage/backend"
import type { ToolRequest } from "../shared/permission-policy"
import type { ChatRecord, StoreState } from "./events"
import { cloneTranscriptEntries } from "./events"
import {
  coalesceContextWindowUpdates,
  decodeHistoryCursor,
  encodeHistoryCursor,
  fitLimitToByteBudget,
  getHistorySnapshot,
  getMessagesPageFromEntries,
  MIN_RECENT_PAGE_ENTRIES,
  RECENT_PAGE_BYTE_BUDGET,
} from "./history-paging"
import type { StoreLayout } from "./event-logs"
import type { SeenMessageIds } from "./seen-message-ids"


export function estimateTranscriptBytes(entries: readonly TranscriptEntry[]): number {
  return JSON.stringify(entries).length
}

const DEFAULT_TRANSCRIPT_CACHE_MAX_BYTES = 24 * 1024 * 1024

export class TranscriptCache {
  private readonly byChat = new Map<string, TranscriptEntry[]>()
  private readonly bytesByChat = new Map<string, number>()
  private totalBytes = 0
  private readonly seededChatIds = new Set<string>()

  constructor(
    private readonly maxChats: number = 4,
    private readonly maxBytes: number = DEFAULT_TRANSCRIPT_CACHE_MAX_BYTES,
  ) {}

  get(chatId: string): TranscriptEntry[] | undefined {
    const entries = this.byChat.get(chatId)
    if (!entries) return undefined
    this.byChat.delete(chatId)
    this.byChat.set(chatId, entries)
    return entries
  }

  set(chatId: string, entries: TranscriptEntry[], bytes?: number): void {
    const entryBytes = bytes ?? estimateTranscriptBytes(entries)
    if (entryBytes > this.maxBytes) return
    this.drop(chatId)
    this.byChat.set(chatId, entries)
    this.addBytes(chatId, entryBytes)
    this.evict()
  }

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

  markSeeded(chatId: string): void {
    this.seededChatIds.add(chatId)
  }

  isSeeded(chatId: string): boolean {
    return this.byChat.has(chatId) || this.seededChatIds.has(chatId)
  }

  invalidate(chatId: string): void {
    this.drop(chatId)
    this.tailByChat.delete(chatId)
    this.seededChatIds.delete(chatId)
  }

  invalidateAll(): void {
    this.byChat.clear()
    this.bytesByChat.clear()
    this.totalBytes = 0
    this.tailByChat.clear()
    this.seededChatIds.clear()
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


  private readonly tailByChat = new Map<string, CachedTail>()

  getTail(chatId: string, fileSize: number, limit: number): TranscriptTailResult | undefined {
    const hit = this.tailByChat.get(chatId)
    if (!hit || hit.fileSize !== fileSize || hit.limit !== limit) return undefined
    return hit.tail
  }

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


export interface MessageReadDeps {
  readonly storage: StorageBackend
  readonly layout: StoreLayout
  readonly transcriptCache: TranscriptCache
  readonly legacyMessagesByChatId: Map<string, TranscriptEntry[]>
  readonly seenMessageIds: SeenMessageIds
  readonly queuedMessagesByChatId: StoreState["queuedMessagesByChatId"]
  readonly chatsById: Map<string, ChatRecord>
  listPendingToolRequests: (chatId: string) => ToolRequest[]
}


const TAIL_CHUNK_BYTES = 256 * 1024
const NEWLINE = 0x0a
const utf8Decoder = new TextDecoder()

export interface TranscriptTailResult {
  entries: TranscriptEntry[]
  lineOffsets: number[]
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
        }
      }
    }
    lineStart = i + 1
  }
  return { entries, lineOffsets }
}

const TAIL_BUDGET_MARGIN = 1.25

export function readTranscriptTail(
  deps: MessageReadDeps,
  chatId: string,
  minEntries: number,
  endOffset?: number,
  chunkBytes: number = TAIL_CHUNK_BYTES,
  byteBudget?: number,
): TranscriptTailResult {
  const { storage } = deps
  const tPath = deps.layout.transcriptPath(chatId)
  if (!storage.existsSync(tPath)) {
    return { entries: [], lineOffsets: [], reachedStart: true }
  }
  const fileSize = storage.sizeSync(tPath)
  const end = Math.min(endOffset ?? fileSize, fileSize)
  if (end <= 0) {
    return { entries: [], lineOffsets: [], reachedStart: true }
  }
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

export function ensureSeenIdsSeeded(deps: MessageReadDeps, chatId: string): void {
  if (!deps.transcriptCache.isSeeded(chatId)) seedSeenMessageIdsFromTail(deps, chatId)
}

function seedFullTranscript(deps: MessageReadDeps, chatId: string, entries: TranscriptEntry[]): void {
  for (const entry of entries) deps.seenMessageIds.record(chatId, entry)
  deps.transcriptCache.set(chatId, entries)
  deps.transcriptCache.markSeeded(chatId)
}

export function seedSeenMessageIdsFromTail(deps: MessageReadDeps, chatId: string): void {
  const tail = readTranscriptTail(deps, chatId, 500)
  if (tail.reachedStart) {
    seedFullTranscript(deps, chatId, tail.entries)
    return
  }
  for (const entry of tail.entries) deps.seenMessageIds.record(chatId, entry)
  deps.transcriptCache.markSeeded(chatId)
}

function readEntryAtOffset(deps: MessageReadDeps, chatId: string, offset: number): TranscriptEntry | null {
  const { storage } = deps
  const tPath = deps.layout.transcriptPath(chatId)
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
  const coalesced = nextEntry
    ? coalesceContextWindowUpdates([...tail.entries, nextEntry]).slice(0, -1)
    : coalesceContextWindowUpdates(tail.entries)
  const effectiveLimit =
    byteBudget === undefined ? limit : fitLimitToByteBudget(coalesced, limit, byteBudget)
  const startIdx = Math.max(0, coalesced.length - effectiveLimit)
  const pageEntries = coalesced.slice(startIdx)
  const hasOlder = !tail.reachedStart || startIdx > 0
  let olderOffset: number | undefined
  const first = pageEntries[0]
  if (hasOlder && first) {
    olderOffset = tail.lineOffsets[tail.entries.indexOf(first)]
  } else if (hasOlder) {
    olderOffset = tail.lineOffsets[0]
  }
  const olderCursor = olderOffset === undefined ? null : encodeHistoryCursor({ kind: "byte", offset: olderOffset })
  return {
    messages: cloneTranscriptEntries(pageEntries),
    hasOlder,
    olderCursor,
  }
}

export function getRecentMessagesPageTail(
  deps: MessageReadDeps,
  chatId: string,
  limit: number,
  chunkBytes?: number,
): ChatHistoryPage {
  const { storage } = deps
  const tPath = deps.layout.transcriptPath(chatId)
  const fileSize = storage.existsSync(tPath) ? storage.sizeSync(tPath) : null

  const cached = fileSize === null ? undefined : deps.transcriptCache.getTail(chatId, fileSize, limit)
  const tail =
    cached ?? readTranscriptTail(deps, chatId, limit, undefined, chunkBytes, RECENT_PAGE_BYTE_BUDGET)
  if (!cached && fileSize !== null) {
    deps.transcriptCache.setTail(chatId, fileSize, limit, tail)
  }
  if (tail.reachedStart) {
    seedFullTranscript(deps, chatId, tail.entries)
  }
  return pageFromTail(tail, limit, undefined, RECENT_PAGE_BYTE_BUDGET)
}


const USAGE_SCAN_MIN_ENTRIES = 32
const USAGE_SCAN_FIRST_CHUNK_BYTES = 64 * 1024
const USAGE_SCAN_GROWTH = 8
const USAGE_SCAN_MAX_CHUNK_BYTES = 1024 * 1024

const USAGE_SCAN_MAX_LOOKBACK_BYTES = 8 * 1024 * 1024

type TailScan<T> = { found: true; value: T } | { found: false }

function scanTranscriptBackward<T>(
  deps: MessageReadDeps,
  chatId: string,
  scan: (entries: readonly TranscriptEntry[]) => TailScan<T>,
  notFound: T,
): T {
  const fromEntries = (entries: readonly TranscriptEntry[]) => {
    const result = scan(entries)
    return result.found ? result.value : notFound
  }
  if (deps.transcriptCache.has(chatId) || deps.legacyMessagesByChatId.has(chatId)) {
    return fromEntries(getMessagesView(deps, chatId))
  }

  const fileSize = deps.storage.sizeSync(deps.layout.transcriptPath(chatId))
  let windowEnd = fileSize
  let chunkBytes = USAGE_SCAN_FIRST_CHUNK_BYTES
  for (;;) {
    const tail = readTranscriptTail(deps, chatId, USAGE_SCAN_MIN_ENTRIES, windowEnd, chunkBytes)
    const result = scan(tail.entries)
    if (result.found) return result.value
    if (tail.reachedStart) return notFound

    const nextEnd = tail.lineOffsets[0]
    if (nextEnd === undefined || nextEnd <= 0) return notFound

    windowEnd = nextEnd
    if (fileSize - windowEnd >= USAGE_SCAN_MAX_LOOKBACK_BYTES) return notFound
    chunkBytes = Math.min(chunkBytes * USAGE_SCAN_GROWTH, USAGE_SCAN_MAX_CHUNK_BYTES)
  }
}

export function getLatestChatContextWindowUsage(
  deps: MessageReadDeps,
  chatId: string,
): ContextWindowUsageSnapshot | null {
  return scanTranscriptBackward<ContextWindowUsageSnapshot | null>(deps, chatId, (entries) => {
    const scan = scanLatestContextWindowUsage(entries)
    return scan.found ? { found: true, value: scan.usage } : { found: false }
  }, null)
}

function scanLatestCumulativeCost(entries: readonly TranscriptEntry[]): TailScan<number | undefined> {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i]
    if (entry.kind === "context_cleared") return { found: true, value: undefined }
    if (entry.kind === "result" && entry.cumulativeCostUsd !== undefined) {
      return { found: true, value: entry.cumulativeCostUsd }
    }
  }
  return { found: false }
}

export function getLatestClaudeCumulativeCostUsd(
  deps: MessageReadDeps,
  chatId: string,
): number | undefined {
  return scanTranscriptBackward(deps, chatId, scanLatestCumulativeCost, undefined)
}


export function loadTranscriptFromDisk(
  deps: MessageReadDeps,
  chatId: string,
): TranscriptEntry[] {
  return loadTranscriptWithBytes(deps, chatId).entries
}

export function loadTranscriptWithBytes(
  deps: MessageReadDeps,
  chatId: string,
): { entries: TranscriptEntry[]; bytes: number } {
  const tPath = deps.layout.transcriptPath(chatId)
  if (!deps.storage.existsSync(tPath)) {
    return { entries: [], bytes: 0 }
  }

  const text = deps.storage.readTextSync(tPath)
  if (!text.trim()) return { entries: [], bytes: 0 }

  const entries: TranscriptEntry[] = []
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim()
    if (!line) continue
    const entry: TranscriptEntry = JSON.parse(line)
    entries.push(entry)
    deps.seenMessageIds.record(chatId, entry)
  }
  return { entries, bytes: text.length }
}

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
  deps.transcriptCache.markSeeded(chatId)
  return entries
}

export function getMessages(deps: MessageReadDeps, chatId: string): TranscriptEntry[] {
  return cloneTranscriptEntries(getMessagesView(deps, chatId))
}

export function getRecentRawEntries(
  deps: MessageReadDeps,
  chatId: string,
  limit: number,
): readonly TranscriptEntry[] {
  const cached = deps.transcriptCache.get(chatId)
  if (cached) {
    return cached.length <= limit ? cached : cached.slice(-limit)
  }

  const { entries } = readTranscriptTail(deps, chatId, limit)
  return entries.length <= limit ? entries : entries.slice(-limit)
}

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

export function getQueuedMessage(
  deps: MessageReadDeps,
  chatId: string,
  queuedMessageId: string,
): QueuedChatMessage | null {
  return getQueuedMessages(deps, chatId).find((entry) => entry.id === queuedMessageId) ?? null
}

export function getRecentMessagesPage(
  deps: MessageReadDeps,
  chatId: string,
  limit: number,
): ChatHistoryPage {
  if (limit <= 0) {
    return { messages: [], hasOlder: false, olderCursor: null }
  }

  if (!deps.transcriptCache.has(chatId) && !deps.legacyMessagesByChatId.has(chatId)) {
    return getRecentMessagesPageTail(deps, chatId, limit)
  }

  const entries = coalesceContextWindowUpdates(getMessagesView(deps, chatId))
  return getMessagesPageFromEntries(entries, fitLimitToByteBudget(entries, limit))
}

export function getMessagesPageBefore(
  deps: MessageReadDeps,
  chatId: string,
  beforeCursor: string,
  limit: number,
): ChatHistoryPage {
  if (limit <= 0) {
    return { messages: [], hasOlder: false, olderCursor: null }
  }

  const cursor = decodeHistoryCursor(beforeCursor)
  if (cursor.kind === "byte") {
    const tail = readTranscriptTail(deps, chatId, limit, cursor.offset)
    return pageFromTail(tail, limit, readEntryAtOffset(deps, chatId, cursor.offset))
  }

  const entries = coalesceContextWindowUpdates(getMessagesView(deps, chatId))
  return getMessagesPageFromEntries(entries, limit, cursor.index)
}

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
    history: getHistorySnapshot(page, recentLimit),
  }
}

export function getChatCount(deps: MessageReadDeps, projectId: string): number {
  return [...deps.chatsById.values()].filter(
    (chat) => chat.projectId === projectId && !chat.deletedAt && !chat.archivedAt,
  ).length
}
