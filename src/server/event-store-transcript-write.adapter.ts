import { LOG_PREFIX } from "../shared/branding"
import type { JsonObject } from "../shared/json"
import { log } from "../shared/log"
import { STORE_VERSION } from "../shared/types"
import type { TranscriptEntry } from "../shared/types"
import type { ToolRequest } from "../shared/permission-policy"
import type { ChatEvent, ChatRecord, StoreEvent } from "./events"
import { cloneTranscriptEntries } from "./events"
import { isSendToStartingProfilingEnabled } from "./claude-steer-log"
import { requireLiveChat } from "./event-store-lookup"
import { subagentResultsDir } from "./paths"
import type { LogWriter } from "./event-store-writer"
import { messageIdOf } from "./seen-message-ids"
import {
  buildArchiveChatEvent,
  buildChatProviderEvent,
  buildPendingForkSessionTokenEvent,
  buildPlanModeEvent,
  buildUnarchiveChatEvent,
} from "./event-store-write-ops"
import { deleteToolRequestsForChat } from "./event-store-tool-requests"
import { applyChatMessageMetadata, getForkedChatTitle } from "./event-store-chat-lifecycle"
import { ensureSeenIdsSeeded, getMessages, type MessageReadDeps } from "./event-store-messages.adapter"
import type { ChatOp } from "../shared/chat-ops"

const STALE_EMPTY_CHAT_MAX_AGE_MS = 30 * 60 * 1000


export interface ChatTranscriptWriteDeps {
  readonly read: MessageReadDeps
  readonly writer: LogWriter
  readonly toolRequestsById: Map<string, ToolRequest>
  commit: (event: StoreEvent) => Promise<void>
  recordChatOp: (chatId: string, op: ChatOp) => void
  clearChatOps: (chatId: string) => void
}


function logAppendProfile(stage: string, details: JsonObject): void {
  if (!isSendToStartingProfilingEnabled()) return
  log.info("[kanna/send->starting][server]", JSON.stringify({ stage, ...details }))
}


export async function removeSubagentResultsDir(
  deps: ChatTranscriptWriteDeps,
  projectId: string,
  chatId: string,
): Promise<void> {
  const dir = subagentResultsDir(deps.read.layout.dataDir, projectId, chatId)
  try {
    await deps.read.storage.remove(dir, { recursive: true })
  } catch (err) {
    log.warn(`${LOG_PREFIX} subagent-results cleanup failed`, { chatId, err })
  }
}

export async function forkChat(
  deps: ChatTranscriptWriteDeps,
  sourceChatId: string,
): Promise<ChatRecord> {
  const sourceChat = requireLiveChat(deps.read.chatsById, sourceChatId)
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
  await deps.commit(createEvent)

  const providerEv = buildChatProviderEvent(deps.read.chatsById, chatId, sourceProvider)
  if (providerEv) await deps.commit(providerEv)

  const planEv = buildPlanModeEvent(deps.read.chatsById, chatId, sourceChat.planMode)
  if (planEv) await deps.commit(planEv)

  const forkTokenEv = buildPendingForkSessionTokenEvent(
    deps.read.chatsById, chatId, { provider: sourceProvider, token: sourceSessionToken },
  )
  if (forkTokenEv) await deps.commit(forkTokenEv)

  const sourceEntries = getMessages(deps.read, sourceChatId)
  if (sourceEntries.length > 0) {
    const tPath = deps.read.layout.transcriptPath(chatId)
    const payload = sourceEntries.map((entry) => JSON.stringify(entry)).join("\n")
    await deps.writer.serialize(async () => {
      await deps.read.storage.mkdir(deps.read.layout.transcriptsDir)
      await deps.read.storage.writeText(tPath, `${payload}\n`)
      const chat = deps.read.chatsById.get(chatId)
      if (chat) {
        chat.hasMessages = true
        chat.updatedAt = Math.max(chat.updatedAt, createdAt)
      }
      deps.read.transcriptCache.invalidateTail(chatId)
      if (deps.read.transcriptCache.has(chatId)) {
        deps.read.transcriptCache.set(chatId, cloneTranscriptEntries(sourceEntries))
      }
    })
  }

  return deps.read.chatsById.get(chatId)!
}

async function teardownChat(
  deps: ChatTranscriptWriteDeps,
  chat: ChatRecord,
  timestamp: number,
): Promise<void> {
  await deps.commit({ v: STORE_VERSION, type: "chat_deleted", timestamp, chatId: chat.id })
  deleteToolRequestsForChat(deps.toolRequestsById, chat.id)
  deps.clearChatOps(chat.id)
  await deps.read.storage.remove(deps.read.layout.transcriptPath(chat.id))
  deps.read.transcriptCache.invalidate(chat.id)
  await removeSubagentResultsDir(deps, chat.projectId, chat.id)
}

export async function deleteChat(
  deps: ChatTranscriptWriteDeps,
  chatId: string,
): Promise<void> {
  await teardownChat(deps, requireLiveChat(deps.read.chatsById, chatId), Date.now())
}

export async function archiveChat(
  deps: ChatTranscriptWriteDeps,
  chatId: string,
): Promise<void> {
  await deps.commit(buildArchiveChatEvent(deps.read.chatsById, chatId))
}

export async function unarchiveChat(
  deps: ChatTranscriptWriteDeps,
  chatId: string,
): Promise<void> {
  await deps.commit(buildUnarchiveChatEvent(deps.read.chatsById, chatId))
}

export async function pruneStaleEmptyChats(
  deps: ChatTranscriptWriteDeps,
  args?: {
    now?: number
    maxAgeMs?: number
    activeChatIds?: Iterable<string>
    protectedChatIds?: Iterable<string>
    onlyChatIds?: Iterable<string>
  },
): Promise<string[]> {
  const now = args?.now ?? Date.now()
  const maxAgeMs = args?.maxAgeMs ?? STALE_EMPTY_CHAT_MAX_AGE_MS
  const protectedChatIds = new Set([
    ...(args?.activeChatIds ?? []),
    ...(args?.protectedChatIds ?? []),
  ])
  const onlyChatIds = args?.onlyChatIds ? new Set(args.onlyChatIds) : null
  const prunedChatIds: string[] = []

  for (const chat of deps.read.chatsById.values()) {
    if (onlyChatIds && !onlyChatIds.has(chat.id)) continue
    if (chat.deletedAt || chat.archivedAt || protectedChatIds.has(chat.id)) continue
    if (now - chat.createdAt < maxAgeMs) continue
    if (chat.hasMessages) continue
    if (getMessages(deps.read, chat.id).length > 0) {
      chat.hasMessages = true
      continue
    }

    await teardownChat(deps, chat, now)
    prunedChatIds.push(chat.id)
  }

  return prunedChatIds
}

export async function appendMessage(
  deps: ChatTranscriptWriteDeps,
  chatId: string,
  entry: TranscriptEntry,
): Promise<void> {
  requireLiveChat(deps.read.chatsById, chatId)
  const payload = `${JSON.stringify(entry)}\n`
  const tPath = deps.read.layout.transcriptPath(chatId)
  const queuedAt = performance.now()
  await deps.writer.serialize(async () => {
    const startedAt = performance.now()
    const queueDelayMs = Number((startedAt - queuedAt).toFixed(1))
    const messageId = messageIdOf(entry)
    if (messageId !== null) {
      ensureSeenIdsSeeded(deps.read, chatId)
      if (deps.read.seenMessageIds.has(chatId, messageId)) {
        logAppendProfile("event_store.append_message_dedup", {
          chatId,
          messageId,
          kind: entry.kind,
        })
        return
      }
      deps.read.seenMessageIds.record(chatId, entry)
    }
    await deps.read.storage.mkdir(deps.read.layout.transcriptsDir)
    const beforeAppendAt = performance.now()
    await deps.read.storage.appendText(tPath, payload)
    const afterAppendAt = performance.now()
    applyChatMessageMetadata(deps.read.chatsById, chatId, entry)
    deps.read.transcriptCache.appendTo(chatId, { ...entry })
    deps.recordChatOp(chatId, { kind: "entries.append", entries: [{ ...entry }] })
    logAppendProfile("event_store.append_message", {
      chatId,
      entryId: entry._id,
      kind: entry.kind,
      payloadBytes: payload.length,
      queueDelayMs,
      appendMs: Number((afterAppendAt - beforeAppendAt).toFixed(1)),
      totalMs: Number((afterAppendAt - queuedAt).toFixed(1)),
    })
  })
}
