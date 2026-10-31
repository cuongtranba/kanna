import { homedir } from "node:os"
import path from "node:path"
import { getDataDir } from "../shared/branding"
import type { StorageBackend } from "./storage/backend"
import { FsStorageBackend } from "./storage/fs-storage.adapter"
import type { AgentProvider, ChatHistoryPage, ModelOptions, QueuedChatMessage, StackBinding, SubagentRunSnapshot, TranscriptEntry } from "../shared/types"
import type { ChatAutomationEvent } from "./auto-continue/events"
import * as ChatTasks from "./event-store-tasks"
import type { ChatTaskEvent } from "../shared/chat-tasks/types"
import type { ChatTaskProjection } from "../shared/chat-tasks/read-model"
import type { ChatTaskScheduleContext } from "../shared/chat-tasks/schedule"
import {
  type StackRecord,
  type StoreEvent,
  type StoreState,
  type SubagentRunEvent,
  type TurnRunConfig,
  createEmptyState,
  isChatAutomationEvent,
} from "./events"
import { logOfEvent } from "./event-routes"
import { storeLayoutFor, type StoreLayout } from "./event-logs"
import { LogWriter } from "./event-store-writer"
import { liveRecord, requireLiveChat } from "./event-store-lookup"
import { SeenMessageIds } from "./seen-message-ids"
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
import { recordCompactionFinished } from "./compaction"
import { applyStoreEvent } from "./event-store-apply"
import { ChatOpLog } from "./chat-op-log"
import * as PeripheralEvents from "./event-store-peripheral-events.adapter"
import * as MessageRead from "./event-store-messages.adapter"
import * as TranscriptWrite from "./event-store-transcript-write.adapter"
import {
  createBootState,
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
  buildChatModelEvent,
  buildChatProviderEvent,
  buildChatReadStateEvent,
  buildAttachChatProjectsEvent,
  buildChatSourceHashEvent,
  buildCompactFailuresEvent,
  buildCreateChatEvent,
  buildCreateStackEvent,
  buildEnqueueMessageResult,
  buildOpenProjectResult,
  buildPendingForkSessionTokenEvent,
  buildPlanModeEvent,
  buildRemoveProjectEvent,
  buildDeleteProjectEvents,
  buildRemoveProjectFromStackEvent,
  buildRemoveQueuedMessageEvent,
  buildRemoveStackEvent,
  buildRenameStackEvent,
  buildSetProjectInstructionsEvent,
  buildSetStackInstructionsEvent,
  buildRenameChatEvent,
  buildSessionTokenEvent,
  buildSetProjectStarEvent,
  buildSetChatPinEvent,
  buildTurnCancelledEvent,
  buildTurnFailedEvent,
  buildTurnFinishedEvent,
  buildTurnStartedEvent,
  computeNewSidebarOrder,
} from "./event-store-write-ops"

export interface ChatTaskDecision<R> {
  events: readonly ChatTaskEvent[]
  result: R
}

export type TurnOutcome = "finished" | "failed" | "cancelled"

export type TurnTerminalListener = (chatId: string, outcome: TurnOutcome, error?: string) => void

export class EventStore implements PushEventStore {
  readonly dataDir: string
  readonly state: StoreState = createEmptyState()
  private readonly layout: StoreLayout
  private readonly writer: LogWriter
  private readonly pendingNativeTaskCalls: ChatTasks.PendingNativeTaskCalls = new Map()
  private readonly turnTerminalListeners = new Set<TurnTerminalListener>()
  private legacyMessagesByChatId = new Map<string, TranscriptEntry[]>()
  private readonly seenMessageIds = new SeenMessageIds()
  private lastUserMessageIdByChatId = new Map<string, string>()
  private readonly sidebarProjectOrderRef: { value: string[] } = { value: [] }
  private readonly boot = createBootState()
  private readonly transcriptCache = new MessageRead.TranscriptCache()
  readonly chatOps = new ChatOpLog()
  private readonly tunnelEventsByChatId = new Map<string, CloudflareTunnelEvent[]>()
  private shareEventsAll: ShareEvent[] = []
  private replayChatProvider = new Map<string, AgentProvider | null>()

  private readonly storage: StorageBackend

  private readonly initDeps: EventStoreInitDeps
  private readonly msgReadDeps: MessageRead.MessageReadDeps
  private readonly peripheralDeps: PeripheralEvents.PeripheralEventsDeps
  private readonly chatTranscriptDeps: TranscriptWrite.ChatTranscriptWriteDeps
  private readonly toolRequestDeps: ToolRequestWriteDeps
  private readonly appendSubagentDeps: AppendSubagentDeps

  constructor(dataDir = getDataDir(homedir()), storage: StorageBackend = new FsStorageBackend()) {
    this.dataDir = dataDir
    this.storage = storage
    this.layout = storeLayoutFor(dataDir)
    this.writer = new LogWriter(storage)

    this.peripheralDeps = {
      storage: this.storage,
      layout: this.layout,
      writer: this.writer,
      tunnelEventsByChatId: this.tunnelEventsByChatId,
      isLiveChat: (chatId) => this.getChat(chatId) !== null,
      shareEventsAll: this.shareEventsAll,
    }

    this.initDeps = {
      storage: this.storage,
      layout: this.layout,
      state: this.state,
      legacyMessagesByChatId: this.legacyMessagesByChatId,
      tunnelEventsByChatId: this.tunnelEventsByChatId,
      transcriptCache: this.transcriptCache,
      sidebarProjectOrderRef: this.sidebarProjectOrderRef,
      boot: this.boot,
      peripheral: this.peripheralDeps,
      replayChatProvider: this.replayChatProvider,
      applyEvent: (event) => { this.applyEvent(event) },
    }

    this.msgReadDeps = {
      storage: this.storage,
      layout: this.layout,
      transcriptCache: this.transcriptCache,
      legacyMessagesByChatId: this.legacyMessagesByChatId,
      seenMessageIds: this.seenMessageIds,
      queuedMessagesByChatId: this.state.queuedMessagesByChatId,
      chatsById: this.state.chatsById,
      listPendingToolRequests: (chatId) => this.listPendingToolRequests(chatId),
    }

    this.chatTranscriptDeps = {
      read: this.msgReadDeps,
      writer: this.writer,
      toolRequestsById: this.state.toolRequestsById,
      commit: (event) => this.commit(event),
      recordChatOp: (chatId, op) => { this.chatOps.record(chatId, op) },
      clearChatOps: (chatId) => { this.chatOps.clear(chatId) },
    }

    this.toolRequestDeps = {
      toolRequestsById: this.state.toolRequestsById,
      commit: (event) => this.commit(event),
    }

    this.appendSubagentDeps = {
      chatsById: this.state.chatsById,
      dataDir: this.dataDir,
      applyEvent: (e) => { this.applyEvent(e) },
      persistDetached: (event) => { this.writer.appendDetached(this.layout.logPath(logOfEvent(event)), event) },
    }
  }

  async initialize() {
    await initializeEventStore(this.initDeps)
  }

  private applyEvent(event: StoreEvent) {
    applyStoreEvent(event, this.state, this.legacyMessagesByChatId, this.replayChatProvider)
    this.tap?.onEventApplied(event)
    if (isChatAutomationEvent(event)) return
    const typedEvent: Exclude<StoreEvent, ChatAutomationEvent> = event
    if (typedEvent.type === "chat_deleted") {
      const { chatId } = typedEvent
      this.seenMessageIds.forget(chatId)
      this.lastUserMessageIdByChatId.delete(chatId)
      this.transcriptCache.invalidate(chatId)
      this.legacyMessagesByChatId.delete(chatId)
      this.tunnelEventsByChatId.delete(chatId)
    }
  }

  private commit(event: StoreEvent): Promise<void> {
    return this.writer.append(this.layout.logPath(logOfEvent(event)), event, () => { this.applyEvent(event) })
  }

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

  async deleteProject(projectId: string) {
    for (const event of buildDeleteProjectEvents(this.state, projectId)) await this.commit(event)
    await this.setSidebarProjectOrder(this.sidebarProjectOrderRef.value)
    await this.storage.remove(path.join(this.dataDir, "projects", projectId), { recursive: true })
  }

  async setProjectStar(projectId: string, starred: boolean) { await this.commit(buildSetProjectStarEvent(this.state.projectsById, projectId, starred)) }
  async setChatPin(chatId: string, pinned: boolean) { await this.commit(buildSetChatPinEvent(this.state.chatsById, chatId, pinned)) }

  async createStack(title: string, projectIds: string[]): Promise<StackRecord> {
    const event = buildCreateStackEvent(
      { projectsById: this.state.projectsById, stacksById: this.state.stacksById },
      title,
      projectIds,
    )
    await this.commit(event)
    return this.state.stacksById.get(event.stackId)!
  }

  getStack(stackId: string): StackRecord | null { return liveRecord(this.state.stacksById, stackId) }

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
    await this.writer.serialize(async () => {
      await writeSidebarOrderFile(this.storage, this.layout, newOrder)
      this.sidebarProjectOrderRef.value = [...newOrder]
    })
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

  async attachChatProjects(chatId: string, stackBindings: readonly StackBinding[]) {
    const event = buildAttachChatProjectsEvent(
      { chatsById: this.state.chatsById, projectsById: this.state.projectsById },
      chatId,
      stackBindings,
    )
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
    onlyChatIds?: Iterable<string>
  }) {
    return TranscriptWrite.pruneStaleEmptyChats(this.chatTranscriptDeps, args)
  }

  async setChatProvider(chatId: string, provider: AgentProvider) {
    const ev = buildChatProviderEvent(this.state.chatsById, chatId, provider)
    if (ev) await this.commit(ev)
  }

  async setChatModel(chatId: string, model: string, modelOptions?: ModelOptions) {
    const ev = buildChatModelEvent(this.state.chatsById, chatId, model, modelOptions)
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
    this.tap?.onEntryAppended(chatId, entry)
    const taskEvents = ChatTasks.mirrorTranscriptEntry({
      pending: this.pendingNativeTaskCalls,
      chatTasksByChatId: this.state.chatTasksByChatId,
      chatId,
      entry,
      now: Date.now(),
    })
    if (taskEvents.length > 0) await this.appendChatTaskEvents(taskEvents)
    if (entry.kind === "user_prompt") {
      this.lastUserMessageIdByChatId.set(chatId, entry._id)
    }
    if (entry.kind === "compact_boundary") {
      recordCompactionFinished(this.state.chatsById.get(chatId)?.provider, entry.compactMetadata)
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

  tap: import("./service-bus/event-store-tap").EventStoreTap | null = null

  subscribeTurnTerminal(listener: TurnTerminalListener): () => void {
    this.turnTerminalListeners.add(listener)
    return () => { this.turnTerminalListeners.delete(listener) }
  }

  private notifyTurnTerminal(chatId: string, outcome: TurnOutcome, error?: string) {
    for (const listener of this.turnTerminalListeners) listener(chatId, outcome, error)
  }

  async recordTurnFinished(chatId: string) {
    await this.commit(buildTurnFinishedEvent(this.state.chatsById, chatId))
    this.notifyTurnTerminal(chatId, "finished")
  }

  async recordTurnFailed(chatId: string, error: string) {
    await this.commit(buildTurnFailedEvent(this.state.chatsById, chatId, error))
    this.notifyTurnTerminal(chatId, "failed", error)
  }

  async recordTurnCancelled(chatId: string) {
    await this.commit(buildTurnCancelledEvent(this.state.chatsById, chatId))
    this.notifyTurnTerminal(chatId, "cancelled")
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

  getProject(projectId: string) { return liveRecord(this.state.projectsById, projectId) }

  requireChat(chatId: string) { return requireLiveChat(this.state.chatsById, chatId) }

  getChat(chatId: string) { return liveRecord(this.state.chatsById, chatId) }

  getSidebarProjectOrder() { return [...this.sidebarProjectOrderRef.value] }

  getMessages(chatId: string) { return MessageRead.getMessages(this.msgReadDeps, chatId) }

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

  getLatestClaudeCumulativeCostUsd(chatId: string) {
    return MessageRead.getLatestClaudeCumulativeCostUsd(this.msgReadDeps, chatId)
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

  async appendAutoContinueEvent(event: ChatAutomationEvent) { return this.commit(event) }

  async appendChatTaskEvents(events: readonly ChatTaskEvent[]): Promise<void> {
    for (const event of events) await this.commit(event)
  }

  async decideChatTaskEvents<R>(
    chatId: string,
    ctx: ChatTaskScheduleContext,
    decide: (projection: ChatTaskProjection) => ChatTaskDecision<R>,
  ): Promise<ChatTaskDecision<R>> {
    return this.writer.serialize(async () => {
      const decision = decide(ChatTasks.projectChatTasks(this.state.chatTasksByChatId, chatId, ctx))
      for (const event of decision.events) {
        await this.writer.appendInsideStep(this.layout.logPath(logOfEvent(event)), event, () => { this.applyEvent(event) })
      }
      return decision
    })
  }

  getChatTaskEvents(chatId: string): ChatTaskEvent[] {
    const list = this.state.chatTasksByChatId.get(chatId)
    return list ? [...list] : []
  }

  getChatTasks(chatId: string, ctx: ChatTaskScheduleContext): ChatTaskProjection {
    return ChatTasks.projectChatTasks(this.state.chatTasksByChatId, chatId, ctx)
  }

  getAutoContinueEvents(chatId: string): ChatAutomationEvent[] {
    const list = this.state.autoContinueEventsByChatId.get(chatId)
    return list ? [...list] : []
  }

  listAutoContinueChats(): string[] { return [...this.state.autoContinueEventsByChatId.keys()] }

  listChatsWithQueuedMessages(): string[] {
    return [...this.state.queuedMessagesByChatId.entries()]
      .filter(([, entries]) => entries.length > 0)
      .map(([chatId]) => chatId)
  }

  async appendTunnelEvent(event: CloudflareTunnelEvent): Promise<void> { return PeripheralEvents.appendTunnelEvent(this.peripheralDeps, event) }

  getTunnelEvents(chatId: string): CloudflareTunnelEvent[] { return PeripheralEvents.getTunnelEvents(this.peripheralDeps, chatId) }

  listTunnelChats(): string[] { return PeripheralEvents.listTunnelChats(this.peripheralDeps) }

  async appendShareEvent(event: ShareEvent): Promise<void> { return PeripheralEvents.appendShareEvent(this.peripheralDeps, event) }

  getShareEvents(): ShareEvent[] { return PeripheralEvents.getShareEvents(this.peripheralDeps) }

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

  async flush(): Promise<void> { await this.writer.flush() }
}
