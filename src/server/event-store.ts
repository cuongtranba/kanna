import { homedir } from "node:os"
import path from "node:path"
import { getDataDir, LOG_PREFIX } from "../shared/branding"
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
  buildPutToolRequestEvent,
  buildResolveToolRequestEvent,
} from "./event-store-write-ops"
import {
  getSubagentRuns as getSubagentRunsFromMap,
  runningSubagentRuns as runningSubagentRunsFromMap,
} from "./event-store-subagent"
import {
  applyToolRequestEvent,
  getToolRequest as getToolRequestFromMap,
  listPendingToolRequests as listPendingToolRequestsFromMap,
  scanAllToolRequests as scanAllToolRequestsFromMap,
} from "./event-store-tool-requests"
import { applyStoreEvent } from "./event-store-apply"
import {
  buildSnapshotFile,
  computeLegacyTranscriptStats,
  migrateLegacyTranscripts as migrateLegacyTranscriptsImpl,
  truncateLogsAfterSnapshot,
  type LegacyTranscriptStats,
  type SnapshotLogPaths,
} from "./event-store-snapshot"
import {
  appendTunnelEvent as appendTunnelEventFn,
  appendShareEvent as appendShareEventFn,
  appendPushEvent as appendPushEventFn,
  getTunnelEvents as getTunnelEventsFn,
  listTunnelChats as listTunnelChatsFn,
  loadTunnelEvents as loadTunnelEventsFn,
  getShareEvents as getShareEventsFn,
  loadShareEvents as loadShareEventsFn,
  loadPushEvents as loadPushEventsFn,
  type PeripheralEventsDeps,
} from "./event-store-peripheral-events.adapter"
import {
  getMessages as getMessagesFn,
  getQueuedMessages as getQueuedMessagesFn,
  getQueuedMessage as getQueuedMessageFn,
  getRecentMessagesPage as getRecentMessagesPageFn,
  getMessagesPageBefore as getMessagesPageBeforeFn,
  getRecentChatHistory as getRecentChatHistoryFn,
  getChatCount as getChatCountFn,
  getSeenMessageIds as getSeenMessageIdsFn,
  type CachedTranscriptRef,
  type MessageReadDeps,
} from "./event-store-messages.adapter"
import {
  openProject as openProjectFn,
  removeProject as removeProjectFn,
  setProjectStar as setProjectStarFn,
  createStack as createStackFn,
  renameStack as renameStackFn,
  removeStack as removeStackFn,
  addProjectToStack as addProjectToStackFn,
  removeProjectFromStack as removeProjectFromStackFn,
  setSidebarProjectOrder as setSidebarProjectOrderFn,
  createChat as createChatFn,
  renameChat as renameChatFn,
  setChatProvider as setChatProviderFn,
  setPlanMode as setPlanModeFn,
  setCompactFailureCount as setCompactFailureCountFn,
  setChatReadState as setChatReadStateFn,
  setChatPolicyOverride as setChatPolicyOverrideFn,
  setSourceHash as setSourceHashFn,
  enqueueMessage as enqueueMessageFn,
  removeQueuedMessage as removeQueuedMessageFn,
  recordTurnStarted as recordTurnStartedFn,
  recordTurnFinished as recordTurnFinishedFn,
  recordTurnFailed as recordTurnFailedFn,
  recordTurnCancelled as recordTurnCancelledFn,
  setSessionTokenForProvider as setSessionTokenForProviderFn,
  recordSessionCommandsLoaded as recordSessionCommandsLoadedFn,
  setPendingForkSessionToken as setPendingForkSessionTokenFn,
  appendAutoContinueEvent as appendAutoContinueEventFn,
  type EntityWriteDeps,
  type SessionWriteDeps,
} from "./event-store-entity-write"
import {
  forkChat as forkChatFn,
  deleteChat as deleteChatFn,
  archiveChat as archiveChatFn,
  unarchiveChat as unarchiveChatFn,
  pruneStaleEmptyChats as pruneStaleEmptyChatsImpl,
  appendMessage as appendMessageFn,
  type ChatTranscriptWriteDeps,
} from "./event-store-transcript-write.adapter"
import {
  initializeEventStore,
  clearEventStoreLegacyTranscriptState,
  type EventStoreInitDeps,
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
  private readonly cachedTranscriptRef: CachedTranscriptRef = { value: null }
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

  private clearLegacyTranscriptState() {
    clearEventStoreLegacyTranscriptState(this.buildInitDeps())
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
      setSnapshotHasLegacyMessages: (v) => { this.snapshotHasLegacyMessages = v },
      getStorageReset: () => this.storageReset,
      setStorageReset: (v) => { this.storageReset = v },
      replayChatProvider: this.replayChatProvider,
      applyEvent: (event) => { this.applyEvent(event) },
    }
  }

  private buildMessageReadDeps(): MessageReadDeps {
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

  private buildPeripheralEventsDeps(): PeripheralEventsDeps {
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

  private buildEntityWriteDeps(): EntityWriteDeps {
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

  private buildSessionWriteDeps(): SessionWriteDeps {
    return {
      chatsById: this.state.chatsById,
      turnsLogPath: this.turnsLogPath,
      schedulesLogPath: this.schedulesLogPath,
      append: (filePath, event) => this.append(filePath, event),
    }
  }

  private buildChatTranscriptWriteDeps(): ChatTranscriptWriteDeps {
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

  // ─── Private helpers ─────────────────────────────────────────────────────

  private getSeenMessageIds(chatId: string): Set<string> {
    return getSeenMessageIdsFn(this.buildMessageReadDeps(), chatId)
  }

  async openProject(localPath: string, title?: string) {
    return openProjectFn(this.buildEntityWriteDeps(), localPath, title)
  }

  async removeProject(projectId: string) {
    return removeProjectFn(this.buildEntityWriteDeps(), projectId)
  }

  async setProjectStar(projectId: string, starred: boolean) {
    return setProjectStarFn(this.buildEntityWriteDeps(), projectId, starred)
  }

  async createStack(title: string, projectIds: string[]): Promise<StackRecord> {
    return createStackFn(this.buildEntityWriteDeps(), title, projectIds)
  }

  getStack(stackId: string): StackRecord | null {
    const stack = this.state.stacksById.get(stackId)
    return stack && !stack.deletedAt ? stack : null
  }

  listStacks(): StackRecord[] {
    return [...this.state.stacksById.values()].filter((s) => !s.deletedAt)
  }

  async renameStack(stackId: string, title: string): Promise<void> {
    return renameStackFn(this.buildEntityWriteDeps(), stackId, title)
  }

  async removeStack(stackId: string): Promise<void> {
    return removeStackFn(this.buildEntityWriteDeps(), stackId)
  }

  async addProjectToStack(stackId: string, projectId: string): Promise<void> {
    return addProjectToStackFn(this.buildEntityWriteDeps(), stackId, projectId)
  }

  async removeProjectFromStack(stackId: string, projectId: string): Promise<void> {
    return removeProjectFromStackFn(this.buildEntityWriteDeps(), stackId, projectId)
  }

  async setSidebarProjectOrder(projectIds: string[]) {
    return setSidebarProjectOrderFn(this.buildEntityWriteDeps(), projectIds)
  }

  async createChat(
    projectId: string,
    options?: { stackId?: string; stackBindings?: StackBinding[] },
  ): Promise<import("./events").ChatRecord> {
    return createChatFn(this.buildEntityWriteDeps(), projectId, options)
  }

  async forkChat(sourceChatId: string) {
    return forkChatFn(this.buildChatTranscriptWriteDeps(), sourceChatId)
  }

  async renameChat(chatId: string, title: string) {
    return renameChatFn(this.buildEntityWriteDeps(), chatId, title)
  }

  async deleteChat(chatId: string) {
    return deleteChatFn(this.buildChatTranscriptWriteDeps(), chatId)
  }

  async archiveChat(chatId: string) {
    return archiveChatFn(this.buildChatTranscriptWriteDeps(), chatId)
  }

  async unarchiveChat(chatId: string) {
    return unarchiveChatFn(this.buildChatTranscriptWriteDeps(), chatId)
  }

  async pruneStaleEmptyChats(args?: {
    now?: number
    maxAgeMs?: number
    activeChatIds?: Iterable<string>
    protectedChatIds?: Iterable<string>
  }) {
    return pruneStaleEmptyChatsImpl(this.buildChatTranscriptWriteDeps(), args)
  }

  async setChatProvider(chatId: string, provider: AgentProvider) {
    return setChatProviderFn(this.buildEntityWriteDeps(), chatId, provider)
  }

  async setPlanMode(chatId: string, planMode: boolean) {
    return setPlanModeFn(this.buildEntityWriteDeps(), chatId, planMode)
  }

  async setCompactFailureCount(chatId: string, compactFailureCount: number) {
    return setCompactFailureCountFn(this.buildEntityWriteDeps(), chatId, compactFailureCount)
  }

  async setChatReadState(chatId: string, unread: boolean) {
    return setChatReadStateFn(this.buildEntityWriteDeps(), chatId, unread)
  }

  async setChatPolicyOverride(chatId: string, policyOverride: ChatPermissionPolicyOverride | null) {
    return setChatPolicyOverrideFn(this.buildEntityWriteDeps(), chatId, policyOverride)
  }

  async appendMessage(chatId: string, entry: TranscriptEntry) {
    return appendMessageFn(this.buildChatTranscriptWriteDeps(), chatId, entry)
  }

  async enqueueMessage(chatId: string, message: Omit<QueuedChatMessage, "id" | "createdAt"> & Partial<Pick<QueuedChatMessage, "id" | "createdAt">>) {
    return enqueueMessageFn(this.buildEntityWriteDeps(), chatId, message)
  }

  async removeQueuedMessage(chatId: string, queuedMessageId: string) {
    return removeQueuedMessageFn(this.buildEntityWriteDeps(), chatId, queuedMessageId)
  }

  async recordTurnStarted(chatId: string, runConfig?: TurnRunConfig) {
    return recordTurnStartedFn(this.buildSessionWriteDeps(), chatId, runConfig)
  }

  async recordTurnFinished(chatId: string) {
    return recordTurnFinishedFn(this.buildSessionWriteDeps(), chatId)
  }

  async recordTurnFailed(chatId: string, error: string) {
    return recordTurnFailedFn(this.buildSessionWriteDeps(), chatId, error)
  }

  async recordTurnCancelled(chatId: string) {
    return recordTurnCancelledFn(this.buildSessionWriteDeps(), chatId)
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
    return setSessionTokenForProviderFn(this.buildSessionWriteDeps(), chatId, provider, sessionToken)
  }

  async recordSessionCommandsLoaded(chatId: string, commands: SlashCommand[]) {
    return recordSessionCommandsLoadedFn(this.buildSessionWriteDeps(), chatId, commands)
  }

  async setPendingForkSessionToken(chatId: string, value: { provider: AgentProvider; token: string } | null) {
    return setPendingForkSessionTokenFn(this.buildSessionWriteDeps(), chatId, value)
  }

  async setSourceHash(chatId: string, sourceHash: string | null) {
    return setSourceHashFn(this.buildEntityWriteDeps(), chatId, sourceHash)
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
    return [...this.sidebarProjectOrderRef.value]
  }

  // ─── Message read methods (thin delegates) ────────────────────────────────

  getMessages(chatId: string) {
    return getMessagesFn(this.buildMessageReadDeps(), chatId)
  }

  getQueuedMessages(chatId: string) {
    return getQueuedMessagesFn(this.buildMessageReadDeps(), chatId)
  }

  getQueuedMessage(chatId: string, queuedMessageId: string) {
    return getQueuedMessageFn(this.buildMessageReadDeps(), chatId, queuedMessageId)
  }

  getRecentMessagesPage(chatId: string, limit: number): ChatHistoryPage {
    return getRecentMessagesPageFn(this.buildMessageReadDeps(), chatId, limit)
  }

  getMessagesPageBefore(chatId: string, beforeCursor: string, limit: number): ChatHistoryPage {
    return getMessagesPageBeforeFn(this.buildMessageReadDeps(), chatId, beforeCursor, limit)
  }

  getRecentChatHistory(chatId: string, recentLimit: number) {
    return getRecentChatHistoryFn(this.buildMessageReadDeps(), chatId, recentLimit)
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
    return getChatCountFn(this.buildMessageReadDeps(), projectId)
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
    const logPaths: SnapshotLogPaths = {
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
    await truncateLogsAfterSnapshot(
      this.storage,
      logPaths,
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
      () => { this.cachedTranscriptRef.value = null },
      onProgress,
    )
  }

  async appendAutoContinueEvent(event: AutoContinueEvent) { return appendAutoContinueEventFn(this.buildSessionWriteDeps(), event) }

  getAutoContinueEvents(chatId: string): AutoContinueEvent[] {
    const list = this.state.autoContinueEventsByChatId.get(chatId)
    return list ? [...list] : []
  }

  listAutoContinueChats(): string[] {
    return [...this.state.autoContinueEventsByChatId.keys()]
  }

  // ─── Peripheral event methods (thin delegates) ───────────────────────────

  async appendTunnelEvent(event: CloudflareTunnelEvent): Promise<void> {
    return appendTunnelEventFn(this.buildPeripheralEventsDeps(), event)
  }

  getTunnelEvents(chatId: string): CloudflareTunnelEvent[] {
    return getTunnelEventsFn(this.buildPeripheralEventsDeps(), chatId)
  }

  listTunnelChats(): string[] {
    return listTunnelChatsFn(this.buildPeripheralEventsDeps())
  }

  private async loadTunnelEvents(): Promise<void> {
    await loadTunnelEventsFn(this.buildPeripheralEventsDeps())
  }

  async appendShareEvent(event: ShareEvent): Promise<void> {
    return appendShareEventFn(this.buildPeripheralEventsDeps(), event)
  }

  getShareEvents(): ShareEvent[] {
    return getShareEventsFn(this.buildPeripheralEventsDeps())
  }

  private async loadShareEvents(): Promise<void> {
    await loadShareEventsFn(this.buildPeripheralEventsDeps())
  }

  async appendPushEvent(event: PushEvent): Promise<void> {
    return appendPushEventFn(this.buildPeripheralEventsDeps(), event)
  }

  async loadPushEvents(): Promise<PushEvent[]> {
    return loadPushEventsFn(this.buildPeripheralEventsDeps())
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
