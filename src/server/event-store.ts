import { homedir } from "node:os"
import path from "node:path"
import { getDataDir } from "../shared/branding"
import { log } from "../shared/log"
import type { StorageBackend } from "./storage/backend"
import { FsStorageBackend } from "./storage/fs-storage.adapter"
import type { AgentProvider, ChatHistoryPage, QueuedChatMessage, SlashCommand, StackBinding, SubagentRunSnapshot, TranscriptEntry } from "../shared/types"
import type { AutoContinueEvent } from "./auto-continue/events"
import {
  type OrchestrationEvent,
  type StackRecord,
  type StoreEvent,
  type StoreState,
  type SubagentRunEvent,
  type TurnRunConfig,
  createEmptyState,
} from "./events"
import type { OrchRunSnapshot } from "../shared/orchestration-types"
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
import * as OrchSubscription from "./event-store-orch-subscription"
import { applyStoreEvent } from "./event-store-apply"
import * as PeripheralEvents from "./event-store-peripheral-events.adapter"
import * as MessageRead from "./event-store-messages.adapter"
import * as EntityWrite from "./event-store-entity-write"
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
  private readonly sidebarProjectOrderRef: { value: string[] } = { value: [] }
  private snapshotHasLegacyMessages = false
  private readonly cachedTranscriptRef: MessageRead.CachedTranscriptRef = { value: null }
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

  async initialize() {
    await initializeEventStore(this.buildInitDeps(), {
      loadTunnelEvents: () => this.loadTunnelEvents(),
      loadShareEvents: () => this.loadShareEvents(),
      hasLegacyTranscriptData: () => this.hasLegacyTranscriptData(),
      snapshotAndTruncateLogs: () => this.snapshotAndTruncateLogs(),
    })
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

  // ─── Deps builders ──────────────────────────────────────────────────────────

  private buildInitDeps(): EventStoreInitDeps {
    return {
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
      orchLogPath: this.orchLogPath,
      transcriptsDir: this.transcriptsDir,
      sidebarProjectOrderPath: this.sidebarProjectOrderPath,
      state: this.state,
      legacyMessagesByChatId: this.legacyMessagesByChatId,
      tunnelEventsByChatId: this.tunnelEventsByChatId,
      cachedTranscriptRef: this.cachedTranscriptRef,
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
  }

  private buildMessageReadDeps(): MessageRead.MessageReadDeps {
    return {
      storage: this.storage,
      transcriptsDir: this.transcriptsDir,
      cachedTranscriptRef: this.cachedTranscriptRef,
      legacyMessagesByChatId: this.legacyMessagesByChatId,
      seenMessageIdsByChatId: this.seenMessageIdsByChatId,
      queuedMessagesByChatId: this.state.queuedMessagesByChatId,
      chatsById: this.state.chatsById,
      listPendingToolRequests: (chatId) => this.listPendingToolRequests(chatId),
    }
  }

  private buildPeripheralEventsDeps(): PeripheralEvents.PeripheralEventsDeps {
    return {
      storage: this.storage,
      tunnelLogPath: this.tunnelLogPath,
      sharesLogPath: this.sharesLogPath,
      pushLogPath: this.pushLogPath,
      tunnelEventsByChatId: this.tunnelEventsByChatId,
      shareEventsAll: this.shareEventsAll,
      getWriteChain: () => this.writeChain,
      setWriteChain: (p) => { this.writeChain = p },
    }
  }

  private buildEntityWriteDeps(): EntityWrite.EntityWriteDeps {
    return {
      storage: this.storage,
      dataDir: this.dataDir,
      sidebarProjectOrderPath: this.sidebarProjectOrderPath,
      projectsLogPath: this.projectsLogPath,
      chatsLogPath: this.chatsLogPath,
      queuedMessagesLogPath: this.queuedMessagesLogPath,
      stacksLogPath: this.stacksLogPath,
      projectsById: this.state.projectsById,
      projectIdsByPath: this.state.projectIdsByPath,
      chatsById: this.state.chatsById,
      queuedMessagesByChatId: this.state.queuedMessagesByChatId,
      stacksById: this.state.stacksById,
      sidebarProjectOrderRef: this.sidebarProjectOrderRef,
      getWriteChain: () => this.writeChain,
      setWriteChain: (p) => { this.writeChain = p },
      append: (filePath, event) => this.append(filePath, event),
    }
  }

  private buildSessionWriteDeps(): EntityWrite.SessionWriteDeps {
    return {
      chatsById: this.state.chatsById,
      turnsLogPath: this.turnsLogPath,
      schedulesLogPath: this.schedulesLogPath,
      append: (filePath, event) => this.append(filePath, event),
    }
  }

  private buildChatTranscriptWriteDeps(): TranscriptWrite.ChatTranscriptWriteDeps {
    return {
      storage: this.storage,
      transcriptsDir: this.transcriptsDir,
      dataDir: this.dataDir,
      cachedTranscriptRef: this.cachedTranscriptRef,
      seenMessageIdsByChatId: this.seenMessageIdsByChatId,
      chatsById: this.state.chatsById,
      toolRequestsById: this.state.toolRequestsById,
      chatsLogPath: this.chatsLogPath,
      turnsLogPath: this.turnsLogPath,
      getWriteChain: () => this.writeChain,
      setWriteChain: (p) => { this.writeChain = p },
      append: (filePath, event) => this.append(filePath, event),
      getMessages: (chatId) => this.getMessages(chatId),
      getSeenMessageIds: (chatId) => this.getSeenMessageIds(chatId),
      listPendingToolRequests: (chatId) => this.listPendingToolRequests(chatId),
    }
  }

  private buildOrchSubscriptionDeps(): OrchSubscription.OrchSubscriptionDeps {
    return {
      orchRunsById: this.state.orchRunsById,
      orchLogPath: this.orchLogPath,
      orchRunsSubscribers: this.orchSubscriptionState.orchRunsSubscribers,
      applyEvent: (e) => { this.applyEvent(e) },
      enqueueDiskAppend: (fp, p) => { this.enqueueDiskAppend(fp, p) },
    }
  }

  private buildToolRequestWriteDeps(): ToolRequestWriteDeps {
    return {
      toolRequestsById: this.state.toolRequestsById,
      toolRequestsLogPath: this.toolRequestsLogPath,
      append: (fp, e) => this.append(fp, e),
    }
  }

  private buildAppendSubagentDeps(): AppendSubagentDeps {
    return {
      chatsById: this.state.chatsById,
      turnsLogPath: this.turnsLogPath,
      dataDir: this.dataDir,
      applyEvent: (e) => { this.applyEvent(e) },
      enqueueDiskAppend: (fp, p) => { this.enqueueDiskAppend(fp, p) },
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private getSeenMessageIds(chatId: string): Set<string> { return MessageRead.getSeenMessageIds(this.buildMessageReadDeps(), chatId) }

  async openProject(localPath: string, title?: string) { return EntityWrite.openProject(this.buildEntityWriteDeps(), localPath, title) }

  async removeProject(projectId: string) { return EntityWrite.removeProject(this.buildEntityWriteDeps(), projectId) }

  async setProjectStar(projectId: string, starred: boolean) { return EntityWrite.setProjectStar(this.buildEntityWriteDeps(), projectId, starred) }

  async createStack(title: string, projectIds: string[]): Promise<StackRecord> { return EntityWrite.createStack(this.buildEntityWriteDeps(), title, projectIds) }

  getStack(stackId: string): StackRecord | null {
    const stack = this.state.stacksById.get(stackId)
    return stack && !stack.deletedAt ? stack : null
  }

  listStacks(): StackRecord[] { return [...this.state.stacksById.values()].filter((s) => !s.deletedAt) }

  async renameStack(stackId: string, title: string): Promise<void> { return EntityWrite.renameStack(this.buildEntityWriteDeps(), stackId, title) }

  async removeStack(stackId: string): Promise<void> { return EntityWrite.removeStack(this.buildEntityWriteDeps(), stackId) }

  async addProjectToStack(stackId: string, projectId: string): Promise<void> { return EntityWrite.addProjectToStack(this.buildEntityWriteDeps(), stackId, projectId) }

  async removeProjectFromStack(stackId: string, projectId: string): Promise<void> { return EntityWrite.removeProjectFromStack(this.buildEntityWriteDeps(), stackId, projectId) }

  async setSidebarProjectOrder(projectIds: string[]) { return EntityWrite.setSidebarProjectOrder(this.buildEntityWriteDeps(), projectIds) }

  async createChat(
    projectId: string,
    options?: { stackId?: string; stackBindings?: StackBinding[] },
  ): Promise<import("./events").ChatRecord> {
    return EntityWrite.createChat(this.buildEntityWriteDeps(), projectId, options)
  }

  async forkChat(sourceChatId: string) { return TranscriptWrite.forkChat(this.buildChatTranscriptWriteDeps(), sourceChatId) }

  async renameChat(chatId: string, title: string) { return EntityWrite.renameChat(this.buildEntityWriteDeps(), chatId, title) }

  async deleteChat(chatId: string) { return TranscriptWrite.deleteChat(this.buildChatTranscriptWriteDeps(), chatId) }

  async archiveChat(chatId: string) { return TranscriptWrite.archiveChat(this.buildChatTranscriptWriteDeps(), chatId) }

  async unarchiveChat(chatId: string) { return TranscriptWrite.unarchiveChat(this.buildChatTranscriptWriteDeps(), chatId) }

  async pruneStaleEmptyChats(args?: {
    now?: number
    maxAgeMs?: number
    activeChatIds?: Iterable<string>
    protectedChatIds?: Iterable<string>
  }) {
    return TranscriptWrite.pruneStaleEmptyChats(this.buildChatTranscriptWriteDeps(), args)
  }

  async setChatProvider(chatId: string, provider: AgentProvider) { return EntityWrite.setChatProvider(this.buildEntityWriteDeps(), chatId, provider) }

  async setPlanMode(chatId: string, planMode: boolean) { return EntityWrite.setPlanMode(this.buildEntityWriteDeps(), chatId, planMode) }

  async setCompactFailureCount(chatId: string, compactFailureCount: number) { return EntityWrite.setCompactFailureCount(this.buildEntityWriteDeps(), chatId, compactFailureCount) }

  async setChatReadState(chatId: string, unread: boolean) { return EntityWrite.setChatReadState(this.buildEntityWriteDeps(), chatId, unread) }

  async setChatPolicyOverride(chatId: string, policyOverride: ChatPermissionPolicyOverride | null) { return EntityWrite.setChatPolicyOverride(this.buildEntityWriteDeps(), chatId, policyOverride) }

  async appendMessage(chatId: string, entry: TranscriptEntry) { return TranscriptWrite.appendMessage(this.buildChatTranscriptWriteDeps(), chatId, entry) }

  async enqueueMessage(chatId: string, message: Omit<QueuedChatMessage, "id" | "createdAt"> & Partial<Pick<QueuedChatMessage, "id" | "createdAt">>) { return EntityWrite.enqueueMessage(this.buildEntityWriteDeps(), chatId, message) }

  async removeQueuedMessage(chatId: string, queuedMessageId: string) { return EntityWrite.removeQueuedMessage(this.buildEntityWriteDeps(), chatId, queuedMessageId) }

  async recordTurnStarted(chatId: string, runConfig?: TurnRunConfig) { return EntityWrite.recordTurnStarted(this.buildSessionWriteDeps(), chatId, runConfig) }

  async recordTurnFinished(chatId: string) { return EntityWrite.recordTurnFinished(this.buildSessionWriteDeps(), chatId) }

  async recordTurnFailed(chatId: string, error: string) { return EntityWrite.recordTurnFailed(this.buildSessionWriteDeps(), chatId, error) }

  async recordTurnCancelled(chatId: string) { return EntityWrite.recordTurnCancelled(this.buildSessionWriteDeps(), chatId) }

  async appendSubagentEvent(event: SubagentRunEvent) { return appendSubagentEventFn(this.buildAppendSubagentDeps(), event) }

  getSubagentRuns(chatId: string): Record<string, SubagentRunSnapshot> { return getSubagentRunsFromMap(this.state.subagentRunsByChatId, chatId) }

  *runningSubagentRuns(): Iterable<SubagentRunSnapshot> { yield* runningSubagentRunsFromMap(this.state.subagentRunsByChatId) }

  async setSessionTokenForProvider(chatId: string, provider: AgentProvider, sessionToken: string | null) { return EntityWrite.setSessionTokenForProvider(this.buildSessionWriteDeps(), chatId, provider, sessionToken) }

  async recordSessionCommandsLoaded(chatId: string, commands: SlashCommand[]) { return EntityWrite.recordSessionCommandsLoaded(this.buildSessionWriteDeps(), chatId, commands) }

  async setPendingForkSessionToken(chatId: string, value: { provider: AgentProvider; token: string } | null) {
    return EntityWrite.setPendingForkSessionToken(this.buildSessionWriteDeps(), chatId, value)
  }

  async setSourceHash(chatId: string, sourceHash: string | null) { return EntityWrite.setSourceHash(this.buildEntityWriteDeps(), chatId, sourceHash) }

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

  getMessages(chatId: string) { return MessageRead.getMessages(this.buildMessageReadDeps(), chatId) }

  getQueuedMessages(chatId: string) { return MessageRead.getQueuedMessages(this.buildMessageReadDeps(), chatId) }

  getQueuedMessage(chatId: string, queuedMessageId: string) { return MessageRead.getQueuedMessage(this.buildMessageReadDeps(), chatId, queuedMessageId) }

  getRecentMessagesPage(chatId: string, limit: number): ChatHistoryPage { return MessageRead.getRecentMessagesPage(this.buildMessageReadDeps(), chatId, limit) }

  getMessagesPageBefore(chatId: string, beforeCursor: string, limit: number): ChatHistoryPage { return MessageRead.getMessagesPageBefore(this.buildMessageReadDeps(), chatId, beforeCursor, limit) }

  getRecentChatHistory(chatId: string, recentLimit: number) { return MessageRead.getRecentChatHistory(this.buildMessageReadDeps(), chatId, recentLimit) }

  listProjects() { return [...this.state.projectsById.values()].filter((project) => !project.deletedAt) }

  listChatsByProject(projectId: string) {
    return [...this.state.chatsById.values()]
      .filter((chat) => chat.projectId === projectId && !chat.deletedAt && !chat.archivedAt)
      .sort((a, b) => (b.lastMessageAt ?? b.updatedAt) - (a.lastMessageAt ?? a.updatedAt))
  }

  getChatCount(projectId: string) { return MessageRead.getChatCount(this.buildMessageReadDeps(), projectId) }

  async getLegacyTranscriptStats(): Promise<LegacyTranscriptStats> { return getLegacyTranscriptStatsFn(this.buildInitDeps()) }

  async hasLegacyTranscriptData() { return hasLegacyTranscriptDataFn(this.buildInitDeps()) }

  async snapshotAndTruncateLogs() { return snapshotAndTruncateLogsFn(this.buildInitDeps()) }

  async migrateLegacyTranscripts(onProgress?: (message: string) => void) { return migrateLegacyTranscriptsFn(this.buildInitDeps(), onProgress) }

  async appendAutoContinueEvent(event: AutoContinueEvent) { return EntityWrite.appendAutoContinueEvent(this.buildSessionWriteDeps(), event) }

  getAutoContinueEvents(chatId: string): AutoContinueEvent[] {
    const list = this.state.autoContinueEventsByChatId.get(chatId)
    return list ? [...list] : []
  }

  listAutoContinueChats(): string[] { return [...this.state.autoContinueEventsByChatId.keys()] }

  // ─── Peripheral event methods (thin delegates) ───────────────────────────

  async appendTunnelEvent(event: CloudflareTunnelEvent): Promise<void> { return PeripheralEvents.appendTunnelEvent(this.buildPeripheralEventsDeps(), event) }

  getTunnelEvents(chatId: string): CloudflareTunnelEvent[] { return PeripheralEvents.getTunnelEvents(this.buildPeripheralEventsDeps(), chatId) }

  listTunnelChats(): string[] { return PeripheralEvents.listTunnelChats(this.buildPeripheralEventsDeps()) }

  private async loadTunnelEvents(): Promise<void> { await PeripheralEvents.loadTunnelEvents(this.buildPeripheralEventsDeps()) }

  async appendShareEvent(event: ShareEvent): Promise<void> { return PeripheralEvents.appendShareEvent(this.buildPeripheralEventsDeps(), event) }

  getShareEvents(): ShareEvent[] { return PeripheralEvents.getShareEvents(this.buildPeripheralEventsDeps()) }

  private async loadShareEvents(): Promise<void> { await PeripheralEvents.loadShareEvents(this.buildPeripheralEventsDeps()) }

  async appendPushEvent(event: PushEvent): Promise<void> { return PeripheralEvents.appendPushEvent(this.buildPeripheralEventsDeps(), event) }

  async loadPushEvents(): Promise<PushEvent[]> { return PeripheralEvents.loadPushEvents(this.buildPeripheralEventsDeps()) }

  async putToolRequest(req: ToolRequest): Promise<void> { return putToolRequestFn(this.buildToolRequestWriteDeps(), req) }

  getToolRequest(id: string): ToolRequest | null { return getToolRequestFromMap(this.state.toolRequestsById, id) }

  listPendingToolRequests(chatId: string): ToolRequest[] { return listPendingToolRequestsFromMap(this.state.toolRequestsById, chatId) }

  async resolveToolRequest(
    id: string,
    args: { status: ToolRequestStatus; decision?: ToolRequestDecision; resolvedAt: number; mismatchReason?: string },
  ): Promise<void> {
    return resolveToolRequestFn(this.buildToolRequestWriteDeps(), id, args)
  }

  scanAllToolRequests(): ToolRequest[] { return scanAllToolRequestsFromMap(this.state.toolRequestsById) }

  async flush(): Promise<void> { await this.writeChain }

  private readonly orchSubscriptionState = OrchSubscription.createOrchSubscriptionState()

  appendOrchestrationEvent(event: OrchestrationEvent): Promise<void> { return OrchSubscription.appendOrchestrationEvent(this.buildOrchSubscriptionDeps(), event) }

  subscribeOrchRuns(cb: () => void): () => void { return OrchSubscription.subscribeOrchRuns(this.buildOrchSubscriptionDeps(), cb) }

  getOrchRun(runId: string): OrchRunSnapshot | null { return OrchSubscription.getOrchRun(this.state.orchRunsById, runId) }

  getOrchRuns(): OrchRunSnapshot[] { return OrchSubscription.getOrchRuns(this.state.orchRunsById) }

  *nonTerminalOrchTasks(): Iterable<{ runId: string; taskId: string; state: "claimed" | "running" }> {
    yield* OrchSubscription.nonTerminalOrchTasks(this.state.orchRunsById)
  }

  *gatedOrchTasks(): Iterable<{ runId: string; taskId: string; phaseIndex: number }> {
    yield* OrchSubscription.gatedOrchTasks(this.state.orchRunsById)
  }

  getOrchTaskSpec(runId: string, taskId: string): { prompt: string; scopePaths: string[] } | null {
    return OrchSubscription.getOrchTaskSpec(this.state.orchRunsById, runId, taskId)
  }

  getOrchLastPhaseOutput(runId: string, taskId: string): string | null { return OrchSubscription.getOrchLastPhaseOutput(this.state.orchRunsById, runId, taskId) }

  getOrchRunEvents(runId: string): OrchestrationEvent[] { return OrchSubscription.getOrchRunEvents(this.state.orchRunsById, runId) }
}
