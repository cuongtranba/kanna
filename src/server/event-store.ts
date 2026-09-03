import { homedir } from "node:os"
import path from "node:path"
import { getDataDir } from "../shared/branding"
import { log } from "../shared/log"
import type { StorageBackend } from "./storage/backend"
import { FsStorageBackend } from "./storage/fs-storage.adapter"
import type { AgentProvider, ChatHistoryPage, QueuedChatMessage, StackBinding, SubagentRunSnapshot, TranscriptEntry } from "../shared/types"
import type { AutoContinueEvent } from "./auto-continue/events"
import {
  type StackRecord,
  type StoreEvent,
  type StoreState,
  type SubagentRunEvent,
  type TurnRunConfig,
  type StoreEventKind,
  type LogName,
  LOG_FILES,
  LOG_OF_EVENT,
  createEmptyState,
} from "./events"
import type { ChatPermissionPolicyOverride, ToolRequest, ToolRequestDecision, ToolRequestStatus } from "../shared/permission-policy"
import type { CloudflareTunnelEvent } from "./cloudflare-tunnel/events"
import type { PushEvent, PushEventStore } from "./push/events"
import type { ShareEvent } from "./session-share/share-projection"
import {
  getSubagentRuns as getSubagentRunsFromMap,
  runningSubagentRuns as runningSubagentRunsFromMap,
  appendSubagentEvent as appendSubagentEventFn,
  type AppendSubagentDeps,
} from "./event-store-subagent"
import {
  getToolRequest as getToolRequestFromMap,
  listPendingToolRequests as listPendingToolRequestsFromMap,
  scanAllToolRequests as scanAllToolRequestsFromMap,
  putToolRequest as putToolRequestFn,
  resolveToolRequest as resolveToolRequestFn,
  type ToolRequestWriteDeps,
} from "./event-store-tool-requests"
import { applyStoreEvent } from "./event-store-apply"
import { ChatOpLog } from "./chat-op-log"
import * as PeripheralEvents from "./event-store-peripheral-events.adapter"
import * as MessageRead from "./event-store-messages.adapter"
import * as TranscriptWrite from "./event-store-transcript-write.adapter"
import {
  initializeEventStore,
  getLegacyTranscriptStats as getLegacyTranscriptStatsFn,
  hasLegacyTranscriptData as hasLegacyTranscriptDataFn,
  snapshotAndTruncateLogs as snapshotAndTruncateLogsFn,
  migrateLegacyTranscripts as migrateLegacyTranscriptsFn,
  type EventStoreInitDeps,
  type LegacyTranscriptStats,
} from "./event-store-init"
import { writeSidebarOrderFile } from "./event-store-snapshot"
import {
  buildAddProjectToStackEvent,
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
  buildRemoveProjectEvent,
  buildRemoveProjectFromStackEvent,
  buildRemoveQueuedMessageEvent,
  buildRemoveStackEvent,
  buildRenameStackEvent,
  buildSetProjectInstructionsEvent,
  buildSetStackInstructionsEvent,
  buildRenameChatEvent,
  buildSessionTokenEvent,
  buildSetProjectStarEvent,
  buildTurnCancelledEvent,
  buildTurnFailedEvent,
  buildTurnFinishedEvent,
  buildTurnStartedEvent,
  computeNewSidebarOrder,
} from "./event-store-write-ops"

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
  private readonly transcriptsDir: string
  private readonly sidebarProjectOrderPath: string
  private legacyMessagesByChatId = new Map<string, TranscriptEntry[]>()
  // Track messageId per chat for dedupe in appendMessage. Populated lazily
  // when transcripts are loaded from disk and on every append. Prevents
  // duplicate persistence when the JSONL reader re-emits entries after a
  // PTY respawn / server restart (Claude appends to the same JSONL via
  // --resume; on cold-wake the reader starts at byte 0 and would re-emit).
  private seenMessageIdsByChatId = new Map<string, Set<string>>()
  private lastUserMessageIdByChatId = new Map<string, string>()
  private legacySidebarProjectOrder: string[] = []
  private readonly sidebarProjectOrderRef: { value: string[] } = { value: [] }
  private snapshotHasLegacyMessages = false
  private readonly transcriptCache = new MessageRead.TranscriptCache()
  /** In-memory delta ring backing the `chat.ops` broadcast path. */
  readonly chatOps = new ChatOpLog()
  private readonly tunnelEventsByChatId = new Map<string, CloudflareTunnelEvent[]>()
  private shareEventsAll: ShareEvent[] = []
  private replayChatProvider = new Map<string, AgentProvider | null>()

  private readonly storage: StorageBackend

  // ─── Construction-time deps ─────────────────────────────────────────────────

  private readonly initDeps: EventStoreInitDeps
  private readonly msgReadDeps: MessageRead.MessageReadDeps
  private readonly peripheralDeps: PeripheralEvents.PeripheralEventsDeps
  private readonly chatTranscriptDeps: TranscriptWrite.ChatTranscriptWriteDeps
  private readonly toolRequestDeps: ToolRequestWriteDeps
  private readonly appendSubagentDeps: AppendSubagentDeps

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
    this.transcriptsDir = path.join(this.dataDir, "transcripts")
    this.sidebarProjectOrderPath = path.join(this.dataDir, SIDEBAR_PROJECT_ORDER_FILE)

    this.initDeps = {
      storage: this.storage,
      dataDir: this.dataDir,
      snapshotPath: this.snapshotPath,
      projectsLogPath: this.projectsLogPath,
      chatsLogPath: this.chatsLogPath,
      messagesLogPath: this.messagesLogPath,
      queuedMessagesLogPath: this.queuedMessagesLogPath,
      turnsLogPath: this.turnsLogPath,
      schedulesLogPath: this.schedulesLogPath,
      tunnelLogPath: this.tunnelLogPath,
      sharesLogPath: this.sharesLogPath,
      pushLogPath: this.pushLogPath,
      stacksLogPath: this.stacksLogPath,
      toolRequestsLogPath: this.toolRequestsLogPath,
      transcriptsDir: this.transcriptsDir,
      sidebarProjectOrderPath: this.sidebarProjectOrderPath,
      state: this.state,
      legacyMessagesByChatId: this.legacyMessagesByChatId,
      tunnelEventsByChatId: this.tunnelEventsByChatId,
      transcriptCache: this.transcriptCache,
      sidebarProjectOrderRef: this.sidebarProjectOrderRef,
      getLegacySidebarProjectOrder: () => this.legacySidebarProjectOrder,
      setLegacySidebarProjectOrder: (v) => { this.legacySidebarProjectOrder = v },
      getSnapshotHasLegacyMessages: () => this.snapshotHasLegacyMessages,
      setSnapshotHasLegacyMessages: (v) => { this.snapshotHasLegacyMessages = v },
      getStorageReset: () => this.storageReset,
      setStorageReset: (v) => { this.storageReset = v },
      replayChatProvider: this.replayChatProvider,
      applyEvent: (event) => { this.applyEvent(event) },
    }

    this.msgReadDeps = {
      storage: this.storage,
      transcriptsDir: this.transcriptsDir,
      transcriptCache: this.transcriptCache,
      legacyMessagesByChatId: this.legacyMessagesByChatId,
      seenMessageIdsByChatId: this.seenMessageIdsByChatId,
      queuedMessagesByChatId: this.state.queuedMessagesByChatId,
      chatsById: this.state.chatsById,
      listPendingToolRequests: (chatId) => this.listPendingToolRequests(chatId),
    }

    this.peripheralDeps = {
      storage: this.storage,
      tunnelLogPath: this.tunnelLogPath,
      sharesLogPath: this.sharesLogPath,
      pushLogPath: this.pushLogPath,
      tunnelEventsByChatId: this.tunnelEventsByChatId,
      shareEventsAll: this.shareEventsAll,
      getWriteChain: () => this.writeChain,
      setWriteChain: (p) => { this.writeChain = p },
    }

    this.chatTranscriptDeps = {
      storage: this.storage,
      transcriptsDir: this.transcriptsDir,
      dataDir: this.dataDir,
      transcriptCache: this.transcriptCache,
      seenMessageIdsByChatId: this.seenMessageIdsByChatId,
      chatsById: this.state.chatsById,
      toolRequestsById: this.state.toolRequestsById,
      chatsLogPath: this.chatsLogPath,
      turnsLogPath: this.turnsLogPath,
      getWriteChain: () => this.writeChain,
      setWriteChain: (p) => { this.writeChain = p },
      append: (filePath, event) => this.append(filePath, event),
      getMessages: (chatId) => this.getMessages(chatId),
      ensureTranscriptLoaded: (chatId) => {
        if (!this.transcriptCache.isSeeded(chatId)) {
          // Fast path: seed messageIds from the tail only, avoiding the full-file
          // parse that spikes RSS ~524 MB for a 96 MB transcript. Falls back to
          // the full load when the backend lacks slice APIs.
          if (!MessageRead.seedSeenMessageIdsFromTail(this.msgReadDeps, chatId)) {
            MessageRead.getMessagesView(this.msgReadDeps, chatId)
          }
        }
      },
      getSeenMessageIds: (chatId) => this.getSeenMessageIds(chatId),
      listPendingToolRequests: (chatId) => this.listPendingToolRequests(chatId),
      recordChatOp: (chatId, op) => { this.chatOps.record(chatId, op) },
      clearChatOps: (chatId) => { this.chatOps.clear(chatId) },
    }

    this.toolRequestDeps = {
      toolRequestsById: this.state.toolRequestsById,
      toolRequestsLogPath: this.toolRequestsLogPath,
      append: (fp, e) => this.append(fp, e),
    }

    this.appendSubagentDeps = {
      chatsById: this.state.chatsById,
      turnsLogPath: this.turnsLogPath,
      dataDir: this.dataDir,
      applyEvent: (e) => { this.applyEvent(e) },
      enqueueDiskAppend: (fp, p) => { this.enqueueDiskAppend(fp, p) },
    }
  }

  async initialize() {
    await initializeEventStore(this.initDeps, {
      loadTunnelEvents: () => this.loadTunnelEvents(),
      loadShareEvents: () => this.loadShareEvents(),
      hasLegacyTranscriptData: () => this.hasLegacyTranscriptData(),
      snapshotAndTruncateLogs: () => this.snapshotAndTruncateLogs(),
    })
  }

  private applyEvent(event: StoreEvent) {
    applyStoreEvent(event, this.state, this.legacyMessagesByChatId, this.replayChatProvider)
    if ("kind" in event) return
    const typedEvent: Exclude<StoreEvent, AutoContinueEvent> = event
    if (typedEvent.type === "chat_deleted") {
      const { chatId } = typedEvent
      this.seenMessageIdsByChatId.delete(chatId)
      this.lastUserMessageIdByChatId.delete(chatId)
      this.transcriptCache.invalidate(chatId)
      this.legacyMessagesByChatId.delete(chatId)
      this.tunnelEventsByChatId.delete(chatId)
    }
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

  /** Route a StoreEvent to its log file using LOG_OF_EVENT. */
  private commit(event: StoreEvent): Promise<void> {
    const key: StoreEventKind = "kind" in event ? event.kind : event.type
    const logName: LogName = LOG_OF_EVENT[key]
    const filePath = path.join(this.dataDir, LOG_FILES[logName])
    return this.append(filePath, event)
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private getSeenMessageIds(chatId: string): Set<string> { return MessageRead.getSeenMessageIds(this.msgReadDeps, chatId) }

  async openProject(localPath: string, title?: string) {
    const result = buildOpenProjectResult(
      { projectsById: this.state.projectsById, projectIdsByPath: this.state.projectIdsByPath },
      localPath,
      title,
    )
    if (result.kind === "existing") return result.project
    await this.commit(result.event)
    return this.state.projectsById.get(result.event.projectId)!
  }

  async removeProject(projectId: string) {
    await this.commit(buildRemoveProjectEvent(this.state.projectsById, projectId))
  }

  async setProjectStar(projectId: string, starred: boolean) {
    await this.commit(buildSetProjectStarEvent(this.state.projectsById, projectId, starred))
  }

  async createStack(title: string, projectIds: string[]): Promise<StackRecord> {
    const event = buildCreateStackEvent(
      { projectsById: this.state.projectsById, stacksById: this.state.stacksById },
      title,
      projectIds,
    )
    await this.commit(event)
    return this.state.stacksById.get(event.stackId)!
  }

  getStack(stackId: string): StackRecord | null {
    const stack = this.state.stacksById.get(stackId)
    return stack && !stack.deletedAt ? stack : null
  }

  listStacks(): StackRecord[] { return [...this.state.stacksById.values()].filter((s) => !s.deletedAt) }

  async renameStack(stackId: string, title: string): Promise<void> {
    const event = buildRenameStackEvent(this.state.stacksById, stackId, title)
    if (event) await this.commit(event)
  }

  async setProjectInstructions(projectId: string, instructions: string): Promise<void> {
    const event = buildSetProjectInstructionsEvent(this.state.projectsById, projectId, instructions)
    if (event) await this.commit(event)
  }

  async setStackInstructions(stackId: string, instructions: string): Promise<void> {
    const event = buildSetStackInstructionsEvent(this.state.stacksById, stackId, instructions)
    if (event) await this.commit(event)
  }

  async removeStack(stackId: string): Promise<void> {
    const event = buildRemoveStackEvent(this.state.stacksById, stackId)
    if (event) await this.commit(event)
  }

  async addProjectToStack(stackId: string, projectId: string): Promise<void> {
    const event = buildAddProjectToStackEvent(
      { projectsById: this.state.projectsById, stacksById: this.state.stacksById },
      stackId,
      projectId,
    )
    if (event) await this.commit(event)
  }

  async removeProjectFromStack(stackId: string, projectId: string): Promise<void> {
    const event = buildRemoveProjectFromStackEvent(this.state.stacksById, stackId, projectId)
    if (event) await this.commit(event)
  }

  async setSidebarProjectOrder(projectIds: string[]) {
    const newOrder = computeNewSidebarOrder(
      this.state.projectsById,
      this.sidebarProjectOrderRef.value,
      projectIds,
    )
    if (!newOrder) return
    const newChain = this.writeChain.then(async () => {
      await writeSidebarOrderFile(this.storage, this.dataDir, this.sidebarProjectOrderPath, newOrder)
      this.sidebarProjectOrderRef.value = [...newOrder]
    })
    this.writeChain = newChain
    await newChain
  }

  async createChat(
    projectId: string,
    options?: { stackId?: string; stackBindings?: StackBinding[] },
  ): Promise<import("./events").ChatRecord> {
    const event = buildCreateChatEvent(
      { projectsById: this.state.projectsById, stacksById: this.state.stacksById },
      projectId,
      options,
    )
    await this.commit(event)
    return this.state.chatsById.get(event.chatId)!
  }

  async forkChat(sourceChatId: string) { return TranscriptWrite.forkChat(this.chatTranscriptDeps, sourceChatId) }

  async renameChat(chatId: string, title: string) {
    const event = buildRenameChatEvent(this.state.chatsById, chatId, title)
    if (event) await this.commit(event)
  }

  async deleteChat(chatId: string) { return TranscriptWrite.deleteChat(this.chatTranscriptDeps, chatId) }

  async archiveChat(chatId: string) { return TranscriptWrite.archiveChat(this.chatTranscriptDeps, chatId) }

  async unarchiveChat(chatId: string) { return TranscriptWrite.unarchiveChat(this.chatTranscriptDeps, chatId) }

  async pruneStaleEmptyChats(args?: {
    now?: number
    maxAgeMs?: number
    activeChatIds?: Iterable<string>
    protectedChatIds?: Iterable<string>
  }) {
    return TranscriptWrite.pruneStaleEmptyChats(this.chatTranscriptDeps, args)
  }

  async setChatProvider(chatId: string, provider: AgentProvider) {
    const ev = buildChatProviderEvent(this.state.chatsById, chatId, provider)
    if (ev) await this.commit(ev)
  }

  async setPlanMode(chatId: string, planMode: boolean) {
    const ev = buildPlanModeEvent(this.state.chatsById, chatId, planMode)
    if (ev) await this.commit(ev)
  }

  async setCompactFailureCount(chatId: string, compactFailureCount: number) {
    const ev = buildCompactFailuresEvent(this.state.chatsById, chatId, compactFailureCount)
    if (ev) await this.commit(ev)
  }

  async setChatReadState(chatId: string, unread: boolean) {
    const ev = buildChatReadStateEvent(this.state.chatsById, chatId, unread)
    if (ev) await this.commit(ev)
  }

  async setChatPolicyOverride(chatId: string, policyOverride: ChatPermissionPolicyOverride | null) {
    await this.commit(buildChatPolicyOverrideEvent(this.state.chatsById, chatId, policyOverride))
  }

  async appendMessage(chatId: string, entry: TranscriptEntry) {
    await TranscriptWrite.appendMessage(this.chatTranscriptDeps, chatId, entry)
    if (entry.kind === "user_prompt") {
      this.lastUserMessageIdByChatId.set(chatId, entry._id)
    }
  }

  async enqueueMessage(chatId: string, message: Omit<QueuedChatMessage, "id" | "createdAt"> & Partial<Pick<QueuedChatMessage, "id" | "createdAt">>) {
    const { event, queuedMessage } = buildEnqueueMessageResult(this.state.chatsById, chatId, message)
    await this.commit(event)
    return queuedMessage
  }

  async removeQueuedMessage(chatId: string, queuedMessageId: string) {
    const event = buildRemoveQueuedMessageEvent(
      this.state.chatsById, this.state.queuedMessagesByChatId, chatId, queuedMessageId,
    )
    await this.commit(event)
  }

  async recordTurnStarted(chatId: string, runConfig?: TurnRunConfig) {
    await this.commit(buildTurnStartedEvent(this.state.chatsById, chatId, runConfig))
  }

  /**
   * Observer fired after a turn's terminal event persists — the ONE choke
   * point every provider path funnels through (24 call sites feed these
   * three methods). Currently consumed by the cron feature to attribute a
   * cron-fired turn's outcome; assigned by AgentCoordinator at construction.
   */
  onTurnTerminal: ((chatId: string, outcome: "finished" | "failed" | "cancelled", error?: string) => void) | null = null

  async recordTurnFinished(chatId: string) {
    await this.commit(buildTurnFinishedEvent(this.state.chatsById, chatId))
    this.onTurnTerminal?.(chatId, "finished")
  }

  async recordTurnFailed(chatId: string, error: string) {
    await this.commit(buildTurnFailedEvent(this.state.chatsById, chatId, error))
    this.onTurnTerminal?.(chatId, "failed", error)
  }

  async recordTurnCancelled(chatId: string) {
    await this.commit(buildTurnCancelledEvent(this.state.chatsById, chatId))
    this.onTurnTerminal?.(chatId, "cancelled")
  }

  async appendSubagentEvent(event: SubagentRunEvent) { return appendSubagentEventFn(this.appendSubagentDeps, event) }

  getSubagentRuns(chatId: string): Record<string, SubagentRunSnapshot> { return getSubagentRunsFromMap(this.state.subagentRunsByChatId, chatId) }

  *runningSubagentRuns(): Iterable<SubagentRunSnapshot> { yield* runningSubagentRunsFromMap(this.state.subagentRunsByChatId) }

  async setSessionTokenForProvider(chatId: string, provider: AgentProvider, sessionToken: string | null) {
    const ev = buildSessionTokenEvent(this.state.chatsById, chatId, provider, sessionToken)
    if (ev) await this.commit(ev)
  }

  async setPendingForkSessionToken(chatId: string, value: { provider: AgentProvider; token: string } | null) {
    const ev = buildPendingForkSessionTokenEvent(this.state.chatsById, chatId, value)
    if (ev) await this.commit(ev)
  }

  async setSourceHash(chatId: string, sourceHash: string | null) {
    const ev = buildChatSourceHashEvent(this.state.chatsById, chatId, sourceHash)
    if (ev) await this.commit(ev)
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

  getSidebarProjectOrder() { return [...this.sidebarProjectOrderRef.value] }

  // ─── Message read methods (thin delegates) ────────────────────────────────

  getMessages(chatId: string) { return MessageRead.getMessages(this.msgReadDeps, chatId) }

  /**
   * Returns the `_id` of the most recent `user_prompt` entry for this chat.
   *
   * Hot path: served from the in-memory map that `appendMessage` keeps current.
   * Cold-start fallback: tail-reads the transcript (avoids a full 96 MB load)
   * and caches the result so the next call is free.
   */
  getLastUserMessageId(chatId: string): string | null {
    const cached = this.lastUserMessageIdByChatId.get(chatId)
    if (cached !== undefined) return cached

    const entries = MessageRead.getRecentRawEntries(this.msgReadDeps, chatId, 100)
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]!
      if (e.kind === "user_prompt") {
        this.lastUserMessageIdByChatId.set(chatId, e._id)
        return e._id
      }
    }
    return null
  }

  getRecentRawEntries(chatId: string, limit: number) {
    return MessageRead.getRecentRawEntries(this.msgReadDeps, chatId, limit)
  }

  getLatestContextWindowUsage(chatId: string) {
    return MessageRead.getLatestChatContextWindowUsage(this.msgReadDeps, chatId)
  }

  getQueuedMessages(chatId: string) { return MessageRead.getQueuedMessages(this.msgReadDeps, chatId) }

  getQueuedMessage(chatId: string, queuedMessageId: string) { return MessageRead.getQueuedMessage(this.msgReadDeps, chatId, queuedMessageId) }

  getRecentMessagesPage(chatId: string, limit: number): ChatHistoryPage { return MessageRead.getRecentMessagesPage(this.msgReadDeps, chatId, limit) }

  getMessagesPageBefore(chatId: string, beforeCursor: string, limit: number): ChatHistoryPage { return MessageRead.getMessagesPageBefore(this.msgReadDeps, chatId, beforeCursor, limit) }

  getRecentChatHistory(chatId: string, recentLimit: number) { return MessageRead.getRecentChatHistory(this.msgReadDeps, chatId, recentLimit) }

  listProjects() { return [...this.state.projectsById.values()].filter((project) => !project.deletedAt) }

  listChatsByProject(projectId: string) {
    return [...this.state.chatsById.values()]
      .filter((chat) => chat.projectId === projectId && !chat.deletedAt && !chat.archivedAt)
      .sort((a, b) => (b.lastMessageAt ?? b.updatedAt) - (a.lastMessageAt ?? a.updatedAt))
  }

  getChatCount(projectId: string) { return MessageRead.getChatCount(this.msgReadDeps, projectId) }

  async getLegacyTranscriptStats(): Promise<LegacyTranscriptStats> { return getLegacyTranscriptStatsFn(this.initDeps) }

  async hasLegacyTranscriptData() { return hasLegacyTranscriptDataFn(this.initDeps) }

  async snapshotAndTruncateLogs() { return snapshotAndTruncateLogsFn(this.initDeps) }

  async migrateLegacyTranscripts(onProgress?: (message: string) => void) { return migrateLegacyTranscriptsFn(this.initDeps, onProgress) }

  async appendAutoContinueEvent(event: AutoContinueEvent) { return this.commit(event) }

  getAutoContinueEvents(chatId: string): AutoContinueEvent[] {
    const list = this.state.autoContinueEventsByChatId.get(chatId)
    return list ? [...list] : []
  }

  listAutoContinueChats(): string[] { return [...this.state.autoContinueEventsByChatId.keys()] }

  listChatsWithQueuedMessages(): string[] {
    return [...this.state.queuedMessagesByChatId.entries()]
      .filter(([, entries]) => entries.length > 0)
      .map(([chatId]) => chatId)
  }

  // ─── Peripheral event methods (thin delegates) ───────────────────────────

  async appendTunnelEvent(event: CloudflareTunnelEvent): Promise<void> { return PeripheralEvents.appendTunnelEvent(this.peripheralDeps, event) }

  getTunnelEvents(chatId: string): CloudflareTunnelEvent[] { return PeripheralEvents.getTunnelEvents(this.peripheralDeps, chatId) }

  listTunnelChats(): string[] { return PeripheralEvents.listTunnelChats(this.peripheralDeps) }

  private async loadTunnelEvents(): Promise<void> { await PeripheralEvents.loadTunnelEvents(this.peripheralDeps) }

  async appendShareEvent(event: ShareEvent): Promise<void> { return PeripheralEvents.appendShareEvent(this.peripheralDeps, event) }

  getShareEvents(): ShareEvent[] { return PeripheralEvents.getShareEvents(this.peripheralDeps) }

  private async loadShareEvents(): Promise<void> { await PeripheralEvents.loadShareEvents(this.peripheralDeps) }

  async appendPushEvent(event: PushEvent): Promise<void> { return PeripheralEvents.appendPushEvent(this.peripheralDeps, event) }

  async loadPushEvents(): Promise<PushEvent[]> { return PeripheralEvents.loadPushEvents(this.peripheralDeps) }

  async putToolRequest(req: ToolRequest): Promise<void> { return putToolRequestFn(this.toolRequestDeps, req) }

  getToolRequest(id: string): ToolRequest | null { return getToolRequestFromMap(this.state.toolRequestsById, id) }

  listPendingToolRequests(chatId: string): ToolRequest[] { return listPendingToolRequestsFromMap(this.state.toolRequestsById, chatId) }

  async resolveToolRequest(
    id: string,
    args: { status: ToolRequestStatus; decision?: ToolRequestDecision; resolvedAt: number; mismatchReason?: string },
  ): Promise<void> {
    return resolveToolRequestFn(this.toolRequestDeps, id, args)
  }

  scanAllToolRequests(): ToolRequest[] { return scanAllToolRequestsFromMap(this.state.toolRequestsById) }

  async flush(): Promise<void> { await this.writeChain }
}
