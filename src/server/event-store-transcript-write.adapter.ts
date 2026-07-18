/**
 * Complex chat-transcript write operations extracted from event-store.ts.
 *
 * Contains methods that directly manipulate the transcript JSONL file or
 * perform multi-step chat mutations (fork, delete, prune, appendMessage).
 * All IO is performed through the injected StorageBackend.
 *
 * This module is an adapter (.adapter.ts) because it performs disk IO.
 * It must NOT import from event-store.ts (no circular deps).
 */
import path from "node:path"
import { LOG_PREFIX } from "../shared/branding"
import { log } from "../shared/log"
import { STORE_VERSION } from "../shared/types"
import type { TranscriptEntry } from "../shared/types"
import type { ToolRequest } from "../shared/permission-policy"
import type { ChatEvent, ChatRecord, StoreEvent } from "./events"
import { cloneTranscriptEntries } from "./events"
import type { StorageBackend } from "./storage/backend"
import { getForkedChatTitle, logSendToStartingProfile } from "./event-store-helpers"
import {
  buildArchiveChatEvent,
  buildChatProviderEvent,
  buildPendingForkSessionTokenEvent,
  buildPlanModeEvent,
  buildUnarchiveChatEvent,
} from "./event-store-write-ops"
import { deleteToolRequestsForChat } from "./event-store-tool-requests"
import { applyChatMessageMetadata } from "./event-store-chat-lifecycle"
import type { TranscriptCache } from "./event-store-messages.adapter"
import type { ChatOp } from "../shared/chat-ops"

const STALE_EMPTY_CHAT_MAX_AGE_MS = 30 * 60 * 1000

// ─── Deps interface ────────────────────────────────────────────────────────

export interface ChatTranscriptWriteDeps {
  readonly storage: StorageBackend
  readonly transcriptsDir: string
  readonly dataDir: string
  readonly transcriptCache: TranscriptCache
  readonly seenMessageIdsByChatId: Map<string, Set<string>>
  readonly chatsById: Map<string, ChatRecord>
  readonly toolRequestsById: Map<string, ToolRequest>
  readonly chatsLogPath: string
  readonly turnsLogPath: string
  /** Read the current write-chain promise. */
  getWriteChain: () => Promise<void>
  /** Replace the write-chain promise. */
  setWriteChain: (p: Promise<void>) => void
  /** Core append: writes event to disk + applies to in-memory state. */
  append: <T extends StoreEvent>(filePath: string, event: T) => Promise<void>
  /** Returns transcript entries for a chat (from cache or disk). */
  getMessages: (chatId: string) => TranscriptEntry[]
  /** Loads the transcript into cache (populating seen messageIds) without cloning. */
  ensureTranscriptLoaded: (chatId: string) => void
  /** Returns (or lazily creates) the seen-messageId dedup set for a chat. */
  getSeenMessageIds: (chatId: string) => Set<string>
  /** Returns pending tool requests for a chat. */
  listPendingToolRequests: (chatId: string) => ToolRequest[]
  /** Records a delta op for the `chat.ops` broadcast path. */
  recordChatOp: (chatId: string, op: ChatOp) => void
  /** Drops the chat's op-log (chat deleted/pruned). */
  clearChatOps: (chatId: string) => void
}

// ─── Private helpers ───────────────────────────────────────────────────────

function transcriptPath(deps: ChatTranscriptWriteDeps, chatId: string): string {
  return path.join(deps.transcriptsDir, `${chatId}.jsonl`)
}

function requireChat(deps: ChatTranscriptWriteDeps, chatId: string): ChatRecord {
  const chat = deps.chatsById.get(chatId)
  if (!chat || chat.deletedAt) throw new Error("Chat not found")
  return chat
}

// ─── Exported functions ────────────────────────────────────────────────────

/** Removes the subagent-results directory for a deleted chat (best-effort). */
export async function removeSubagentResultsDir(
  deps: ChatTranscriptWriteDeps,
  projectId: string,
  chatId: string,
): Promise<void> {
  const dir = path.join(
    deps.dataDir, "projects", projectId, "chats", chatId, "subagent-results",
  )
  try {
    await deps.storage.remove(dir, { recursive: true })
  } catch (err) {
    log.warn(`${LOG_PREFIX} subagent-results cleanup failed`, { chatId, err })
  }
}

/** Forks a chat: creates a new chat sharing the source transcript and session. */
export async function forkChat(
  deps: ChatTranscriptWriteDeps,
  sourceChatId: string,
): Promise<ChatRecord> {
  const sourceChat = requireChat(deps, sourceChatId)
  const sourceProvider = sourceChat.provider
  if (!sourceProvider) throw new Error("Chat cannot be forked")

  const sourceSessionToken =
    sourceChat.sessionTokensByProvider[sourceProvider]
    ?? (sourceChat.pendingForkSessionToken?.provider === sourceProvider
      ? sourceChat.pendingForkSessionToken.token
      : null)
  if (!sourceSessionToken) throw new Error("Chat cannot be forked")

  const chatId = crypto.randomUUID()
  const createdAt = Date.now()
  const createEvent: ChatEvent = {
    v: STORE_VERSION,
    type: "chat_created",
    timestamp: createdAt,
    chatId,
    projectId: sourceChat.projectId,
    title: getForkedChatTitle(sourceChat.title),
    ...(sourceChat.stackId !== undefined ? { stackId: sourceChat.stackId } : {}),
    ...(sourceChat.stackBindings !== undefined
      ? { stackBindings: sourceChat.stackBindings.map((b) => ({ ...b })) }
      : {}),
  }
  await deps.append(deps.chatsLogPath, createEvent)

  const providerEv = buildChatProviderEvent(deps.chatsById, chatId, sourceProvider)
  if (providerEv) await deps.append(deps.chatsLogPath, providerEv)

  const planEv = buildPlanModeEvent(deps.chatsById, chatId, sourceChat.planMode)
  if (planEv) await deps.append(deps.chatsLogPath, planEv)

  const forkTokenEv = buildPendingForkSessionTokenEvent(
    deps.chatsById, chatId, { provider: sourceProvider, token: sourceSessionToken },
  )
  if (forkTokenEv) await deps.append(deps.turnsLogPath, forkTokenEv)

  const sourceEntries = deps.getMessages(sourceChatId)
  if (sourceEntries.length > 0) {
    const tPath = transcriptPath(deps, chatId)
    const payload = sourceEntries.map((entry) => JSON.stringify(entry)).join("\n")
    const newChain = deps.getWriteChain().then(async () => {
      await deps.storage.mkdir(deps.transcriptsDir)
      await deps.storage.writeText(tPath, `${payload}\n`)
      const chat = deps.chatsById.get(chatId)
      if (chat) {
        chat.hasMessages = true
        chat.updatedAt = Math.max(chat.updatedAt, createdAt)
      }
      if (deps.transcriptCache.has(chatId)) {
        deps.transcriptCache.set(chatId, cloneTranscriptEntries(sourceEntries))
      }
    })
    deps.setWriteChain(newChain)
    await newChain
  }

  return deps.chatsById.get(chatId)!
}

/** Deletes a chat: appends a delete event, clears tool requests, and removes the results dir. */
export async function deleteChat(
  deps: ChatTranscriptWriteDeps,
  chatId: string,
): Promise<void> {
  const chat = requireChat(deps, chatId)
  const projectId = chat.projectId
  const event: ChatEvent = {
    v: STORE_VERSION,
    type: "chat_deleted",
    timestamp: Date.now(),
    chatId,
  }
  await deps.append(deps.chatsLogPath, event)
  deleteToolRequestsForChat(deps.toolRequestsById, chatId)
  deps.clearChatOps(chatId)
  await removeSubagentResultsDir(deps, projectId, chatId)
}

/** Archives a chat. */
export async function archiveChat(
  deps: ChatTranscriptWriteDeps,
  chatId: string,
): Promise<void> {
  await deps.append(deps.chatsLogPath, buildArchiveChatEvent(deps.chatsById, chatId))
}

/** Unarchives a chat. */
export async function unarchiveChat(
  deps: ChatTranscriptWriteDeps,
  chatId: string,
): Promise<void> {
  await deps.append(deps.chatsLogPath, buildUnarchiveChatEvent(deps.chatsById, chatId))
}

/** Prunes empty chats that have been idle past the max age. Returns pruned chat IDs. */
export async function pruneStaleEmptyChats(
  deps: ChatTranscriptWriteDeps,
  args?: {
    now?: number
    maxAgeMs?: number
    activeChatIds?: Iterable<string>
    protectedChatIds?: Iterable<string>
  },
): Promise<string[]> {
  const now = args?.now ?? Date.now()
  const maxAgeMs = args?.maxAgeMs ?? STALE_EMPTY_CHAT_MAX_AGE_MS
  const protectedChatIds = new Set([
    ...(args?.activeChatIds ?? []),
    ...(args?.protectedChatIds ?? []),
  ])
  const prunedChatIds: string[] = []

  for (const chat of deps.chatsById.values()) {
    if (chat.deletedAt || chat.archivedAt || protectedChatIds.has(chat.id)) continue
    if (now - chat.createdAt < maxAgeMs) continue
    if (chat.hasMessages) continue
    if (deps.getMessages(chat.id).length > 0) {
      chat.hasMessages = true
      continue
    }

    const event: ChatEvent = {
      v: STORE_VERSION,
      type: "chat_deleted",
      timestamp: now,
      chatId: chat.id,
    }
    await deps.append(deps.chatsLogPath, event)

    const tPath = transcriptPath(deps, chat.id)
    await deps.storage.remove(tPath)
    deps.transcriptCache.invalidate(chat.id)
    deps.clearChatOps(chat.id)
    await removeSubagentResultsDir(deps, chat.projectId, chat.id)

    prunedChatIds.push(chat.id)
  }

  return prunedChatIds
}

/** Appends a transcript entry for a chat, with deduplication by messageId. */
export async function appendMessage(
  deps: ChatTranscriptWriteDeps,
  chatId: string,
  entry: TranscriptEntry,
): Promise<void> {
  requireChat(deps, chatId)
  const payload = `${JSON.stringify(entry)}\n`
  const tPath = transcriptPath(deps, chatId)
  const queuedAt = performance.now()
  const newChain = deps.getWriteChain().then(async () => {
    const startedAt = performance.now()
    const queueDelayMs = Number((startedAt - queuedAt).toFixed(1))
    const mid = entry.messageId
    if (typeof mid === "string" && mid.length > 0) {
      deps.ensureTranscriptLoaded(chatId)
      const seen = deps.getSeenMessageIds(chatId)
      if (seen.has(mid)) {
        logSendToStartingProfile("event_store.append_message_dedup", {
          chatId,
          messageId: mid,
          kind: entry.kind,
        })
        return
      }
      seen.add(mid)
    }
    await deps.storage.mkdir(deps.transcriptsDir)
    const beforeAppendAt = performance.now()
    await deps.storage.appendText(tPath, payload)
    const afterAppendAt = performance.now()
    applyChatMessageMetadata(deps.chatsById, chatId, entry)
    deps.transcriptCache.appendTo(chatId, { ...entry })
    deps.recordChatOp(chatId, { kind: "entries.append", entries: [{ ...entry }] })
    logSendToStartingProfile("event_store.append_message", {
      chatId,
      entryId: entry._id,
      kind: entry.kind,
      payloadBytes: payload.length,
      queueDelayMs,
      appendMs: Number((afterAppendAt - beforeAppendAt).toFixed(1)),
      totalMs: Number((afterAppendAt - queuedAt).toFixed(1)),
    })
  })
  deps.setWriteChain(newChain)
  return newChain
}
