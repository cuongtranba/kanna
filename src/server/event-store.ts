import { homedir } from "node:os"
import path from "node:path"
import { getDataDir, LOG_PREFIX } from "../shared/branding"
import { log } from "../shared/log"
import type { StorageBackend } from "./storage/backend"
import { FsStorageBackend } from "./storage/fs-storage.adapter"
import type { AgentProvider, ChatHistoryPage, QueuedChatMessage, SlashCommand, StackBinding, SubagentRunSnapshot, TranscriptEntry } from "../shared/types"
import { STORE_VERSION } from "../shared/types"
import type { AutoContinueEvent } from "./auto-continue/events"
import {
  type ChatEvent,
  type OrchestrationEvent,
  type StackRecord,
  type StoreEvent,
  type StoreState,
  type SubagentRunEvent,
  type TurnRunConfig,
  cloneTranscriptEntries,
  createEmptyState,
} from "./events"
import type { OrchRunSnapshot } from "../shared/orchestration-types"
import {
  gatedOrchTasks,
  getAllOrchRunSnapshots,
  getOrchLastPhaseOutput,
  getOrchRunEvents,
  getOrchRunSnapshot,
  getOrchTaskSpec,
  nonTerminalOrchTasks,
} from "./event-store-orch"
import type { ChatPermissionPolicyOverride, ToolRequest, ToolRequestDecision, ToolRequestStatus } from "../shared/permission-policy"
import type { CloudflareTunnelEvent } from "./cloudflare-tunnel/events"
import type { PushEvent, PushEventStore } from "./push/events"
import type { ShareEvent } from "./session-share/share-projection"
import { capTranscriptEntry } from "./subagent-entry-cap.adapter"
import {
  coalesceContextWindowUpdates,
  decodeCursor,
  getForkedChatTitle,
  getHistorySnapshot,
  getMessagesPageFromEntries,
  logSendToStartingProfile,
} from "./event-store-helpers"
import {
  buildAddProjectToStackEvent,
  buildArchiveChatEvent,
  buildChatPolicyOverrideEvent,
  buildChatProviderEvent,
  buildChatReadStateEvent,
  buildChatSourceHashEvent,
  buildCompactFailuresEvent,
  buildCreateChatEvent,
  buildCreateStackEvent,
  buildEnqueueMessageResult,
  buildOpenProjectResult,
  buildPendingForkSessionTokenEvent,
  buildPlanModeEvent,
  buildPutToolRequestEvent,
  buildRemoveProjectEvent,
  buildRemoveProjectFromStackEvent,
  buildRemoveQueuedMessageEvent,
  buildRemoveStackEvent,
  buildRenameStackEvent,
  buildRenameChatEvent,
  buildResolveToolRequestEvent,
  buildSessionCommandsEvent,
  buildSessionTokenEvent,
  buildSetProjectStarEvent,
  buildTurnCancelledEvent,
  buildTurnFailedEvent,
  buildTurnFinishedEvent,
  buildTurnStartedEvent,
  buildUnarchiveChatEvent,
  computeNewSidebarOrder,
} from "./event-store-write-ops"
import {
  getSubagentRuns as getSubagentRunsFromMap,
  runningSubagentRuns as runningSubagentRunsFromMap,
} from "./event-store-subagent"
import {
  applyToolRequestEvent,
  deleteToolRequestsForChat,
  getToolRequest as getToolRequestFromMap,
  listPendingToolRequests as listPendingToolRequestsFromMap,
  scanAllToolRequests as scanAllToolRequestsFromMap,
} from "./event-store-tool-requests"
import { applyStoreEvent } from "./event-store-apply"
import { applyChatMessageMetadata } from "./event-store-chat-lifecycle"
import {
  applyTunnelEventToMap,
  buildSnapshotFile,
  calcShouldTruncateLogs,
  computeLegacyTranscriptStats,
  loadAndReplayLogs,
  loadPushEventsFromLog,
  loadShareEventsFromLog,
  loadSnapshotIntoState,
  loadSidebarOrder,
  loadTunnelEventsFromLog,
  migrateLegacyTranscripts as migrateLegacyTranscriptsImpl,
  truncateLogsAfterSnapshot,
  writeSidebarOrderFile,
  type LegacyTranscriptStats,
  type SnapshotLogPaths,
} from "./event-store-snapshot"

const STALE_EMPTY_CHAT_MAX_AGE_MS = 30 * 60 * 1000
const SIDEBAR_PROJECT_ORDER_FILE = "sidebar-order.json"

export class EventStore implements PushEventStore {
  readonly dataDir: string
  readonly state: StoreState = createEmptyState()
  private writeChain = Promise.resolve()
  private storageReset = false
  private readonly snapshotPath: string
  private readonly projectsLogPath: string
  private readonly chatsLogPath: string
  private readonly messagesLogPath: string
  private readonly queuedMessagesLogPath: string
  private readonly turnsLogPath: string
  private readonly schedulesLogPath: string
  private readonly tunnelLogPath: string
  private readonly sharesLogPath: string
  private readonly pushLogPath: string
  private readonly stacksLogPath: string
  private readonly toolRequestsLogPath: string
  private readonly orchLogPath: string
  private readonly transcriptsDir: string
  private readonly sidebarProjectOrderPath: string
  private legacyMessagesByChatId = new Map<string, TranscriptEntry[]>()
  // Track messageId per chat for dedupe in appendMessage. Populated lazily
  // when transcripts are loaded from disk and on every append. Prevents
  // duplicate persistence when the JSONL reader re-emits entries after a
  // PTY respawn / server restart (Claude appends to the same JSONL via
  // --resume; on cold-wake the reader starts at byte 0 and would re-emit).
  private seenMessageIdsByChatId = new Map<string, Set<string>>()
  private legacySidebarProjectOrder: string[] = []
  private sidebarProjectOrder: string[] = []
  private snapshotHasLegacyMessages = false
  private cachedTranscript: { chatId: string; entries: TranscriptEntry[] } | null = null
  private readonly tunnelEventsByChatId = new Map<string, CloudflareTunnelEvent[]>()
  private shareEventsAll: ShareEvent[] = []
  private replayChatProvider = new Map<string, AgentProvider | null>()

  private readonly storage: StorageBackend

  constructor(dataDir = getDataDir(homedir()), storage: StorageBackend = new FsStorageBackend()) {
    this.dataDir = dataDir
    this.storage = storage
    this.snapshotPath = path.join(this.dataDir, "snapshot.json")
    this.projectsLogPath = path.join(this.dataDir, "projects.jsonl")
    this.chatsLogPath = path.join(this.dataDir, "chats.jsonl")
    this.messagesLogPath = path.join(this.dataDir, "messages.jsonl")
    this.queuedMessagesLogPath = path.join(this.dataDir, "queued-messages.jsonl")
    this.turnsLogPath = path.join(this.dataDir, "turns.jsonl")
    this.schedulesLogPath = path.join(this.dataDir, "schedules.jsonl")
    this.tunnelLogPath = path.join(this.dataDir, "tunnels.jsonl")
    this.sharesLogPath = path.join(this.dataDir, "shares.jsonl")
    this.pushLogPath = path.join(this.dataDir, "push.jsonl")
    this.stacksLogPath = path.join(this.dataDir, "stacks.jsonl")
    this.toolRequestsLogPath = path.join(this.dataDir, "tool-requests.jsonl")
    this.orchLogPath = path.join(this.dataDir, "orch.jsonl")
    this.transcriptsDir = path.join(this.dataDir, "transcripts")
    this.sidebarProjectOrderPath = path.join(this.dataDir, SIDEBAR_PROJECT_ORDER_FILE)
  }

  private getLogPaths(): SnapshotLogPaths {
    return {
      snapshotPath: this.snapshotPath,
      projectsLogPath: this.projectsLogPath,
      chatsLogPath: this.chatsLogPath,
      messagesLogPath: this.messagesLogPath,
      queuedMessagesLogPath: this.queuedMessagesLogPath,
      turnsLogPath: this.turnsLogPath,
      schedulesLogPath: this.schedulesLogPath,
      stacksLogPath: this.stacksLogPath,
      toolRequestsLogPath: this.toolRequestsLogPath,
      orchLogPath: this.orchLogPath,
    }
  }

  async initialize() {
    await this.storage.mkdir(this.dataDir)
    await this.storage.mkdir(this.transcriptsDir)
    await this.ensureFile(this.projectsLogPath)
    await this.ensureFile(this.chatsLogPath)
    await this.ensureFile(this.messagesLogPath)
    await this.ensureFile(this.queuedMessagesLogPath)
    await this.ensureFile(this.turnsLogPath)
    await this.ensureFile(this.schedulesLogPath)
    await this.ensureFile(this.tunnelLogPath)
    await this.ensureFile(this.sharesLogPath)
    await this.ensureFile(this.pushLogPath)
    await this.ensureFile(this.stacksLogPath)
    await this.ensureFile(this.toolRequestsLogPath)
    await this.ensureFile(this.orchLogPath)
    await this.loadSnapshot()
    await this.replayLogs()
    await this.loadTunnelEvents()
    await this.loadShareEvents()
    await this.loadSidebarProjectOrder()
    if (!(await this.hasLegacyTranscriptData()) && await this.shouldSnapshotLogs()) {
      await this.snapshotAndTruncateLogs()
    }
  }

  private async ensureFile(filePath: string) {
    if (!(await this.storage.exists(filePath))) {
      await this.storage.writeText(filePath, "")
    }
  }

  private async clearStorage() {
    if (this.storageReset) return
    this.storageReset = true
    this.resetState()
    this.clearLegacyTranscriptState()
    await Promise.all([
      this.storage.writeText(this.snapshotPath, ""),
      this.storage.writeText(this.projectsLogPath, ""),
      this.storage.writeText(this.chatsLogPath, ""),
      this.storage.writeText(this.messagesLogPath, ""),
      this.storage.writeText(this.queuedMessagesLogPath, ""),
      this.storage.writeText(this.turnsLogPath, ""),
      this.storage.writeText(this.schedulesLogPath, ""),
      this.storage.writeText(this.tunnelLogPath, ""),
      this.storage.writeText(this.sharesLogPath, ""),
      this.storage.writeText(this.stacksLogPath, ""),
      this.storage.writeText(this.toolRequestsLogPath, ""),
      this.storage.writeText(this.orchLogPath, ""),
    ])
  }

  private async loadSnapshot() {
    const result = await loadSnapshotIntoState(
      this.storage,
      this.snapshotPath,
      this.state,
      this.legacyMessagesByChatId,
      () => this.clearStorage(),
    )
    this.snapshotHasLegacyMessages = result.snapshotHasLegacyMessages
    this.legacySidebarProjectOrder = result.legacySidebarProjectOrder
  }

  private resetState() {
    this.state.projectsById.clear()
    this.state.projectIdsByPath.clear()
    this.state.chatsById.clear()
    this.state.queuedMessagesByChatId.clear()
    this.state.sidebarProjectOrder = []
    this.state.autoContinueEventsByChatId.clear()
    this.state.stacksById.clear()
    this.tunnelEventsByChatId.clear()
    this.sidebarProjectOrder = []
    this.legacySidebarProjectOrder = []
    this.cachedTranscript = null
  }

  private clearLegacyTranscriptState() {
    this.legacyMessagesByChatId.clear()
    this.snapshotHasLegacyMessages = false
  }

  private async loadSidebarProjectOrder() {
    this.sidebarProjectOrder = await loadSidebarOrder(
      this.storage,
      this.sidebarProjectOrderPath,
      this.projectsLogPath,
      this.dataDir,
      this.legacySidebarProjectOrder,
    )
  }

  private async replayLogs() {
    await loadAndReplayLogs(
      this.storage,
      this.getLogPaths(),
      () => this.storageReset,
      (event) => { this.applyEvent(event) },
      () => this.clearStorage(),
      () => { this.replayChatProvider.clear() },
    )
  }

  private applyEvent(event: StoreEvent) {
    applyStoreEvent(event, this.state, this.legacyMessagesByChatId, this.replayChatProvider)
  }

  private enqueueDiskAppend(filePath: string, payload: string): void {
    this.writeChain = this.writeChain
      .then(() => this.storage.appendText(filePath, payload))
      .catch((err) => {
        log.error("[event-store] subagent disk append failed:", err)
      })
  }

  private append<TEvent extends StoreEvent>(filePath: string, event: TEvent) {
    const payload = `${JSON.stringify(event)}\n`
    this.writeChain = this.writeChain.then(async () => {
      await this.storage.appendText(filePath, payload)
      this.applyEvent(event)
    })
    return this.writeChain
  }

  private transcriptPath(chatId: string) {
    return path.join(this.transcriptsDir, `${chatId}.jsonl`)
  }

  private loadTranscriptFromDisk(chatId: string) {
    const transcriptPath = this.transcriptPath(chatId)
    if (!this.storage.existsSync(transcriptPath)) {
      return []
    }

    const text = this.storage.readTextSync(transcriptPath)
    if (!text.trim()) return []

    const entries: TranscriptEntry[] = []
    const seen = this.getSeenMessageIds(chatId)
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

  private getSeenMessageIds(chatId: string): Set<string> {
    let set = this.seenMessageIdsByChatId.get(chatId)
    if (!set) {
      set = new Set<string>()
      this.seenMessageIdsByChatId.set(chatId, set)
    }
    return set
  }

  async openProject(localPath: string, title?: string) {
    const result = buildOpenProjectResult(this.state, localPath, title)
    if (result.kind === "existing") return result.project
    await this.append(this.projectsLogPath, result.event)
    return this.state.projectsById.get(result.event.projectId)!
  }

  async removeProject(projectId: string) {
    const event = buildRemoveProjectEvent(this.state.projectsById, projectId)
    await this.append(this.projectsLogPath, event)
  }

  async setProjectStar(projectId: string, starred: boolean) {
    const event = buildSetProjectStarEvent(this.state.projectsById, projectId, starred)
    await this.append(this.projectsLogPath, event)
  }

  async createStack(title: string, projectIds: string[]): Promise<StackRecord> {
    const event = buildCreateStackEvent(this.state, title, projectIds)
    await this.append(this.stacksLogPath, event)
    return this.state.stacksById.get(event.stackId)!
  }

  getStack(stackId: string): StackRecord | null {
    const stack = this.state.stacksById.get(stackId)
    return stack && !stack.deletedAt ? stack : null
  }

  listStacks(): StackRecord[] {
    return [...this.state.stacksById.values()].filter((s) => !s.deletedAt)
  }

  async renameStack(stackId: string, title: string): Promise<void> {
    const event = buildRenameStackEvent(this.state.stacksById, stackId, title)
    if (event) await this.append(this.stacksLogPath, event)
  }

  async removeStack(stackId: string): Promise<void> {
    const event = buildRemoveStackEvent(this.state.stacksById, stackId)
    if (event) await this.append(this.stacksLogPath, event)
  }

  async addProjectToStack(stackId: string, projectId: string): Promise<void> {
    const event = buildAddProjectToStackEvent(this.state, stackId, projectId)
    if (event) await this.append(this.stacksLogPath, event)
  }

  async removeProjectFromStack(stackId: string, projectId: string): Promise<void> {
    const event = buildRemoveProjectFromStackEvent(this.state.stacksById, stackId, projectId)
    if (event) await this.append(this.stacksLogPath, event)
  }

  async setSidebarProjectOrder(projectIds: string[]) {
    const newOrder = computeNewSidebarOrder(this.state.projectsById, this.sidebarProjectOrder, projectIds)
    if (!newOrder) return
    this.writeChain = this.writeChain.then(async () => {
      await writeSidebarOrderFile(this.storage, this.dataDir, this.sidebarProjectOrderPath, newOrder)
      this.sidebarProjectOrder = [...newOrder]
    })
    return this.writeChain
  }

  async createChat(
    projectId: string,
    options?: { stackId?: string; stackBindings?: StackBinding[] },
  ): Promise<import("./events").ChatRecord> {
    const event = buildCreateChatEvent(this.state, projectId, options)
    await this.append(this.chatsLogPath, event)
    return this.state.chatsById.get(event.chatId)!
  }

  async forkChat(sourceChatId: string) {
    const sourceChat = this.requireChat(sourceChatId)
    const sourceProvider = sourceChat.provider
    if (!sourceProvider) {
      throw new Error("Chat cannot be forked")
    }
    const sourceSessionToken =
      sourceChat.sessionTokensByProvider[sourceProvider]
      ?? (sourceChat.pendingForkSessionToken?.provider === sourceProvider
        ? sourceChat.pendingForkSessionToken.token
        : null)
    if (!sourceSessionToken) {
      throw new Error("Chat cannot be forked")
    }

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
    await this.append(this.chatsLogPath, createEvent)
    await this.setChatProvider(chatId, sourceProvider)
    await this.setPlanMode(chatId, sourceChat.planMode)
    await this.setPendingForkSessionToken(chatId, { provider: sourceProvider, token: sourceSessionToken })

    const sourceEntries = this.getMessages(sourceChatId)
    if (sourceEntries.length > 0) {
      const transcriptPath = this.transcriptPath(chatId)
      const payload = sourceEntries.map((entry) => JSON.stringify(entry)).join("\n")
      this.writeChain = this.writeChain.then(async () => {
        await this.storage.mkdir(this.transcriptsDir)
        await this.storage.writeText(transcriptPath, `${payload}\n`)
        const chat = this.state.chatsById.get(chatId)
        if (chat) {
          chat.hasMessages = true
          chat.updatedAt = Math.max(chat.updatedAt, createdAt)
        }
        if (this.cachedTranscript?.chatId === chatId) {
          this.cachedTranscript = { chatId, entries: cloneTranscriptEntries(sourceEntries) }
        }
      })
      await this.writeChain
    }

    return this.state.chatsById.get(chatId)!
  }

  async renameChat(chatId: string, title: string) {
    const event = buildRenameChatEvent(this.state.chatsById, chatId, title)
    if (event) await this.append(this.chatsLogPath, event)
  }

  async deleteChat(chatId: string) {
    const chat = this.requireChat(chatId)
    const projectId = chat.projectId
    const event: ChatEvent = {
      v: STORE_VERSION,
      type: "chat_deleted",
      timestamp: Date.now(),
      chatId,
    }
    await this.append(this.chatsLogPath, event)
    deleteToolRequestsForChat(this.state.toolRequestsById, chatId)
    await this.removeSubagentResultsDir(projectId, chatId)
  }

  private async removeSubagentResultsDir(projectId: string, chatId: string) {
    const dir = path.join(
      this.dataDir, "projects", projectId, "chats", chatId, "subagent-results",
    )
    try {
      await this.storage.remove(dir, { recursive: true })
    } catch (err) {
      log.warn(`${LOG_PREFIX} subagent-results cleanup failed`, { chatId, err })
    }
  }

  async archiveChat(chatId: string) {
    await this.append(this.chatsLogPath, buildArchiveChatEvent(this.state.chatsById, chatId))
  }

  async unarchiveChat(chatId: string) {
    await this.append(this.chatsLogPath, buildUnarchiveChatEvent(this.state.chatsById, chatId))
  }

  async pruneStaleEmptyChats(args?: {
    now?: number
    maxAgeMs?: number
    activeChatIds?: Iterable<string>
    protectedChatIds?: Iterable<string>
  }) {
    const now = args?.now ?? Date.now()
    const maxAgeMs = args?.maxAgeMs ?? STALE_EMPTY_CHAT_MAX_AGE_MS
    const protectedChatIds = new Set([
      ...(args?.activeChatIds ?? []),
      ...(args?.protectedChatIds ?? []),
    ])
    const prunedChatIds: string[] = []

    for (const chat of this.state.chatsById.values()) {
      if (chat.deletedAt || chat.archivedAt || protectedChatIds.has(chat.id)) continue
      if (now - chat.createdAt < maxAgeMs) continue
      if (chat.hasMessages) continue
      if (this.getMessages(chat.id).length > 0) {
        chat.hasMessages = true
        continue
      }

      const event: ChatEvent = {
        v: STORE_VERSION,
        type: "chat_deleted",
        timestamp: now,
        chatId: chat.id,
      }
      await this.append(this.chatsLogPath, event)

      const transcriptPath = this.transcriptPath(chat.id)
      await this.storage.remove(transcriptPath)
      if (this.cachedTranscript?.chatId === chat.id) {
        this.cachedTranscript = null
      }
      await this.removeSubagentResultsDir(chat.projectId, chat.id)

      prunedChatIds.push(chat.id)
    }

    return prunedChatIds
  }

  async setChatProvider(chatId: string, provider: AgentProvider) {
    const ev = buildChatProviderEvent(this.state.chatsById, chatId, provider)
    if (ev) await this.append(this.chatsLogPath, ev)
  }

  async setPlanMode(chatId: string, planMode: boolean) {
    const ev = buildPlanModeEvent(this.state.chatsById, chatId, planMode)
    if (ev) await this.append(this.chatsLogPath, ev)
  }

  async setCompactFailureCount(chatId: string, compactFailureCount: number) {
    const ev = buildCompactFailuresEvent(this.state.chatsById, chatId, compactFailureCount)
    if (ev) await this.append(this.chatsLogPath, ev)
  }

  async setChatReadState(chatId: string, unread: boolean) {
    const ev = buildChatReadStateEvent(this.state.chatsById, chatId, unread)
    if (ev) await this.append(this.chatsLogPath, ev)
  }

  async setChatPolicyOverride(chatId: string, policyOverride: ChatPermissionPolicyOverride | null) {
    await this.append(this.chatsLogPath, buildChatPolicyOverrideEvent(this.state.chatsById, chatId, policyOverride))
  }

  async appendMessage(chatId: string, entry: TranscriptEntry) {
    this.requireChat(chatId)
    const payload = `${JSON.stringify(entry)}\n`
    const transcriptPath = this.transcriptPath(chatId)
    const queuedAt = performance.now()
    this.writeChain = this.writeChain.then(async () => {
      const startedAt = performance.now()
      const queueDelayMs = Number((startedAt - queuedAt).toFixed(1))
      // Dedupe by messageId: if a transcript entry from the same JSONL source
      // message has already been appended, skip. Server-generated entries
      // without messageId (e.g. interrupted, context_cleared) always append.
      const mid = entry.messageId
      if (typeof mid === "string" && mid.length > 0) {
        // Ensure the transcript is loaded so the seen set is populated.
        this.getMessages(chatId)
        const seen = this.getSeenMessageIds(chatId)
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
      await this.storage.mkdir(this.transcriptsDir)
      const beforeAppendAt = performance.now()
      await this.storage.appendText(transcriptPath, payload)
      const afterAppendAt = performance.now()
      applyChatMessageMetadata(this.state.chatsById, chatId, entry)
      if (this.cachedTranscript?.chatId === chatId) {
        this.cachedTranscript.entries.push({ ...entry })
      }
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
    return this.writeChain
  }

  async enqueueMessage(chatId: string, message: Omit<QueuedChatMessage, "id" | "createdAt"> & Partial<Pick<QueuedChatMessage, "id" | "createdAt">>) {
    const { event, queuedMessage } = buildEnqueueMessageResult(this.state.chatsById, chatId, message)
    await this.append(this.queuedMessagesLogPath, event)
    return queuedMessage
  }

  async removeQueuedMessage(chatId: string, queuedMessageId: string) {
    const event = buildRemoveQueuedMessageEvent(
      this.state.chatsById, this.state.queuedMessagesByChatId, chatId, queuedMessageId,
    )
    await this.append(this.queuedMessagesLogPath, event)
  }

  async recordTurnStarted(chatId: string, runConfig?: TurnRunConfig) {
    await this.append(this.turnsLogPath, buildTurnStartedEvent(this.state.chatsById, chatId, runConfig))
  }

  async recordTurnFinished(chatId: string) {
    await this.append(this.turnsLogPath, buildTurnFinishedEvent(this.state.chatsById, chatId))
  }

  async recordTurnFailed(chatId: string, error: string) {
    await this.append(this.turnsLogPath, buildTurnFailedEvent(this.state.chatsById, chatId, error))
  }

  async recordTurnCancelled(chatId: string) {
    await this.append(this.turnsLogPath, buildTurnCancelledEvent(this.state.chatsById, chatId))
  }

  async appendSubagentEvent(event: SubagentRunEvent) {
    let effectiveEvent = event
    if (event.type === "subagent_entry_appended" && event.entry.kind === "tool_result") {
      const chat = this.state.chatsById.get(event.chatId)
      if (chat) {
        effectiveEvent = {
          ...event,
          entry: await capTranscriptEntry({
            entry: event.entry,
            chatId: event.chatId,
            runId: event.runId,
            projectId: chat.projectId,
            kannaRoot: this.dataDir,
          }),
        }
      }
    }
    // Apply in-memory synchronously so the UI sees the update immediately,
    // decoupled from disk I/O backlog on writeChain (scoped to ephemeral
    // subagent_* events only — structural events keep strict append→apply ordering).
    this.applyEvent(effectiveEvent)
    this.enqueueDiskAppend(this.turnsLogPath, `${JSON.stringify(effectiveEvent)}\n`)
  }

  getSubagentRuns(chatId: string): Record<string, SubagentRunSnapshot> {
    return getSubagentRunsFromMap(this.state.subagentRunsByChatId, chatId)
  }

  *runningSubagentRuns(): Iterable<SubagentRunSnapshot> {
    yield* runningSubagentRunsFromMap(this.state.subagentRunsByChatId)
  }

  async setSessionTokenForProvider(chatId: string, provider: AgentProvider, sessionToken: string | null) {
    const ev = buildSessionTokenEvent(this.state.chatsById, chatId, provider, sessionToken)
    if (ev) await this.append(this.turnsLogPath, ev)
  }

  async recordSessionCommandsLoaded(chatId: string, commands: SlashCommand[]) {
    const ev = buildSessionCommandsEvent(this.state.chatsById, chatId, commands)
    if (ev) await this.append(this.turnsLogPath, ev)
  }

  async setPendingForkSessionToken(chatId: string, value: { provider: AgentProvider; token: string } | null) {
    const ev = buildPendingForkSessionTokenEvent(this.state.chatsById, chatId, value)
    if (ev) await this.append(this.turnsLogPath, ev)
  }

  async setSourceHash(chatId: string, sourceHash: string | null) {
    const ev = buildChatSourceHashEvent(this.state.chatsById, chatId, sourceHash)
    if (ev) await this.append(this.chatsLogPath, ev)
  }

  getProject(projectId: string) {
    const project = this.state.projectsById.get(projectId)
    if (!project || project.deletedAt) return null
    return project
  }

  requireChat(chatId: string) {
    const chat = this.state.chatsById.get(chatId)
    if (!chat || chat.deletedAt) {
      throw new Error("Chat not found")
    }
    return chat
  }

  getChat(chatId: string) {
    const chat = this.state.chatsById.get(chatId)
    if (!chat || chat.deletedAt) return null
    return chat
  }

  getSidebarProjectOrder() {
    return [...this.sidebarProjectOrder]
  }

  getMessages(chatId: string) {
    if (this.cachedTranscript?.chatId === chatId) {
      return cloneTranscriptEntries(this.cachedTranscript.entries)
    }

    const legacyEntries = this.legacyMessagesByChatId.get(chatId)
    if (legacyEntries) {
      this.cachedTranscript = { chatId, entries: cloneTranscriptEntries(legacyEntries) }
      return cloneTranscriptEntries(this.cachedTranscript.entries)
    }

    const entries = this.loadTranscriptFromDisk(chatId)
    this.cachedTranscript = { chatId, entries }
    return cloneTranscriptEntries(entries)
  }

  getQueuedMessages(chatId: string) {
    const entries = this.state.queuedMessagesByChatId.get(chatId) ?? []
    return entries.map((entry) => ({
      ...entry,
      attachments: [...entry.attachments],
    }))
  }

  getQueuedMessage(chatId: string, queuedMessageId: string) {
    return this.getQueuedMessages(chatId).find((entry) => entry.id === queuedMessageId) ?? null
  }

  getRecentMessagesPage(chatId: string, limit: number): ChatHistoryPage {
    if (limit <= 0) {
      return { messages: [], hasOlder: false, olderCursor: null }
    }

    const entries = coalesceContextWindowUpdates(this.getMessages(chatId))
    const page = getMessagesPageFromEntries(entries, limit)

    return {
      messages: page.entries,
      hasOlder: page.hasOlder,
      olderCursor: page.olderCursor,
    }
  }

  getMessagesPageBefore(chatId: string, beforeCursor: string, limit: number): ChatHistoryPage {
    if (limit <= 0) {
      return { messages: [], hasOlder: false, olderCursor: null }
    }

    const beforeIndex = decodeCursor(beforeCursor)
    // Coalesce identically to getRecentMessagesPage so cursors (which index the
    // coalesced array) stay consistent across recent + load-older paging.
    const entries = coalesceContextWindowUpdates(this.getMessages(chatId))
    const page = getMessagesPageFromEntries(entries, limit, beforeIndex)

    return {
      messages: page.entries,
      hasOlder: page.hasOlder,
      olderCursor: page.olderCursor,
    }
  }

  getRecentChatHistory(chatId: string, recentLimit: number) {
    const page = this.getRecentMessagesPage(chatId, recentLimit)
    const pending = this.listPendingToolRequests(chatId)
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
      history: getHistorySnapshot({
        entries: merged,
        hasOlder: page.hasOlder,
        olderCursor: page.olderCursor,
      }, recentLimit),
    }
  }

  listProjects() {
    return [...this.state.projectsById.values()].filter((project) => !project.deletedAt)
  }

  listChatsByProject(projectId: string) {
    return [...this.state.chatsById.values()]
      .filter((chat) => chat.projectId === projectId && !chat.deletedAt && !chat.archivedAt)
      .sort((a, b) => (b.lastMessageAt ?? b.updatedAt) - (a.lastMessageAt ?? a.updatedAt))
  }

  getChatCount(projectId: string) {
    return this.listChatsByProject(projectId).length
  }

  async getLegacyTranscriptStats(): Promise<LegacyTranscriptStats> {
    return computeLegacyTranscriptStats(
      this.storage,
      this.messagesLogPath,
      this.snapshotHasLegacyMessages,
      this.legacyMessagesByChatId,
    )
  }

  async hasLegacyTranscriptData() {
    return (await this.getLegacyTranscriptStats()).hasLegacyData
  }

  async snapshotAndTruncateLogs() {
    const snapshot = buildSnapshotFile(this.state, this.listProjects())
    await truncateLogsAfterSnapshot(
      this.storage,
      this.getLogPaths(),
      JSON.stringify(snapshot, null, 2),
    )
  }

  async migrateLegacyTranscripts(onProgress?: (message: string) => void) {
    const stats = await this.getLegacyTranscriptStats()
    return migrateLegacyTranscriptsImpl(
      this.storage,
      this.transcriptsDir,
      stats,
      this.legacyMessagesByChatId,
      (chatId) => this.transcriptPath(chatId),
      () => { this.clearLegacyTranscriptState() },
      () => this.snapshotAndTruncateLogs(),
      () => { this.cachedTranscript = null },
      onProgress,
    )
  }

  private async shouldSnapshotLogs() {
    return calcShouldTruncateLogs(this.storage, this.getLogPaths())
  }

  async appendAutoContinueEvent(event: AutoContinueEvent) {
    return this.append(this.schedulesLogPath, event)
  }

  getAutoContinueEvents(chatId: string): AutoContinueEvent[] {
    const list = this.state.autoContinueEventsByChatId.get(chatId)
    return list ? [...list] : []
  }

  listAutoContinueChats(): string[] {
    return [...this.state.autoContinueEventsByChatId.keys()]
  }

  async appendTunnelEvent(event: CloudflareTunnelEvent): Promise<void> {
    const payload = `${JSON.stringify(event)}\n`
    this.writeChain = this.writeChain.then(async () => {
      await this.storage.appendText(this.tunnelLogPath, payload)
      applyTunnelEventToMap(this.tunnelEventsByChatId, event)
    })
    await this.writeChain
  }

  getTunnelEvents(chatId: string): CloudflareTunnelEvent[] {
    const list = this.tunnelEventsByChatId.get(chatId)
    return list ? [...list] : []
  }

  listTunnelChats(): string[] {
    return [...this.tunnelEventsByChatId.keys()]
  }

  private async loadTunnelEvents(): Promise<void> {
    await loadTunnelEventsFromLog(this.storage, this.tunnelLogPath, this.tunnelEventsByChatId)
  }

  async appendShareEvent(event: ShareEvent): Promise<void> {
    const payload = `${JSON.stringify(event)}\n`
    this.writeChain = this.writeChain.then(async () => {
      await this.storage.appendText(this.sharesLogPath, payload)
      this.shareEventsAll.push(event)
    })
    await this.writeChain
  }

  getShareEvents(): ShareEvent[] {
    return [...this.shareEventsAll]
  }

  private async loadShareEvents(): Promise<void> {
    await loadShareEventsFromLog(this.storage, this.sharesLogPath, this.shareEventsAll)
  }

  async appendPushEvent(event: PushEvent): Promise<void> {
    const payload = `${JSON.stringify(event)}\n`
    this.writeChain = this.writeChain.then(async () => {
      await this.storage.appendText(this.pushLogPath, payload)
    })
    await this.writeChain
  }

  async loadPushEvents(): Promise<PushEvent[]> {
    return loadPushEventsFromLog(this.storage, this.pushLogPath)
  }

  async putToolRequest(req: ToolRequest): Promise<void> {
    const event = buildPutToolRequestEvent(req)
    applyToolRequestEvent(this.state.toolRequestsById, event)
    await this.append(this.toolRequestsLogPath, event)
  }

  getToolRequest(id: string): ToolRequest | null {
    return getToolRequestFromMap(this.state.toolRequestsById, id)
  }

  listPendingToolRequests(chatId: string): ToolRequest[] {
    return listPendingToolRequestsFromMap(this.state.toolRequestsById, chatId)
  }

  async resolveToolRequest(
    id: string,
    args: { status: ToolRequestStatus; decision?: ToolRequestDecision; resolvedAt: number; mismatchReason?: string },
  ): Promise<void> {
    const event = buildResolveToolRequestEvent(this.state.toolRequestsById, id, args)
    applyToolRequestEvent(this.state.toolRequestsById, event)
    await this.append(this.toolRequestsLogPath, event)
  }

  scanAllToolRequests(): ToolRequest[] {
    return scanAllToolRequestsFromMap(this.state.toolRequestsById)
  }

  async flush(): Promise<void> {
    await this.writeChain
  }

  private readonly orchRunsSubscribers = new Set<() => void>()


  /**
   * Apply synchronously, then enqueue the disk append — the sync apply is what
   * makes an orchestration claim atomic within one event-loop turn (same
   * pattern as appendSubagentEvent).
   */
  appendOrchestrationEvent(event: OrchestrationEvent): Promise<void> {
    this.applyEvent(event)
    this.enqueueDiskAppend(this.orchLogPath, `${JSON.stringify(event)}\n`)
    this.notifyOrchRunsChanged()
    return Promise.resolve()
  }

  /**
   * Observe orchestration read-model changes. The callback fires after each
   * live orch event is applied (not during boot replay — no subscribers yet).
   * Mirrors the registry `.subscribe()` pattern; used by ws-router to push the
   * `orch-runs` topic. Returns an unsubscribe fn.
   */
  subscribeOrchRuns(cb: () => void): () => void {
    this.orchRunsSubscribers.add(cb)
    return () => { this.orchRunsSubscribers.delete(cb) }
  }

  private notifyOrchRunsChanged(): void {
    for (const cb of this.orchRunsSubscribers) {
      try { cb() } catch (err) { log.warn(`${LOG_PREFIX} orch-runs subscriber threw`, { err }) }
    }
  }

  getOrchRun(runId: string): OrchRunSnapshot | null {
    return getOrchRunSnapshot(this.state.orchRunsById, runId)
  }

  getOrchRuns(): OrchRunSnapshot[] {
    return getAllOrchRunSnapshots(this.state.orchRunsById)
  }

  /** Tasks a restart must RE-QUEUE. `gated` is deliberately excluded — a gated task is re-armed in place (gate re-notified), never requeued. */
  *nonTerminalOrchTasks(): Iterable<{ runId: string; taskId: string; state: "claimed" | "running" }> {
    yield* nonTerminalOrchTasks(this.state.orchRunsById)
  }

  /** Tasks paused at a hard gate — re-armed (not requeued) by recoverOnStartup. */
  *gatedOrchTasks(): Iterable<{ runId: string; taskId: string; phaseIndex: number }> {
    yield* gatedOrchTasks(this.state.orchRunsById)
  }

  /** Task spec lookup for the engine (records keep prompt/scope; snapshots do not). */
  getOrchTaskSpec(runId: string, taskId: string): { prompt: string; scopePaths: string[] } | null {
    return getOrchTaskSpec(this.state.orchRunsById, runId, taskId)
  }

  /** Last completed phase's output — {{PRIOR}} context when resuming a gated/recovered task. */
  getOrchLastPhaseOutput(runId: string, taskId: string): string | null {
    return getOrchLastPhaseOutput(this.state.orchRunsById, runId, taskId)
  }

  /** Full ordered event timeline for one run — the rich drill-in source (F8). */
  getOrchRunEvents(runId: string): OrchestrationEvent[] {
    return getOrchRunEvents(this.state.orchRunsById, runId)
  }
}
