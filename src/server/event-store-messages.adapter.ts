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

  const entries = coalesceContextWindowUpdates(getMessagesView(deps, chatId))
  const page = getMessagesPageFromEntries(entries, limit)

  return {
    messages: cloneTranscriptEntries(page.entries),
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

  // Coalesce identically to getRecentMessagesPage so cursors (which index the
  // coalesced array) stay consistent across recent + load-older paging.
  const beforeIndex = decodeCursor(beforeCursor)
  const entries = coalesceContextWindowUpdates(getMessagesView(deps, chatId))
  const page = getMessagesPageFromEntries(entries, limit, beforeIndex)

  return {
    messages: cloneTranscriptEntries(page.entries),
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
