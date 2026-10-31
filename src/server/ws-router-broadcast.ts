import { toError } from "../shared/errors"
import { log } from "../shared/log"
import { PROTOCOL_VERSION } from "../shared/types"
import type { ServerWebSocket } from "bun"
import type { WorkflowRegistry } from "./workflow-registry"
import type { BackgroundTaskOutputRegistry } from "./background-task-output-registry"
import type { BoardChange, BoardRegistry } from "./board-registry"
import type { BeaconRegistry } from "./beacon-registry"
import type { EventStore } from "./event-store"
import type { AgentCoordinator } from "./agent-coordinator"
import type { TerminalManager } from "./terminal-manager"
import type { KeybindingsManager } from "./keybindings"
import type { UpdateManager } from "./update-manager"
import type { PackageUpdateManager } from "./package-update-manager"
import type { ServerEnvelope, SubscriptionTopic } from "../shared/protocol"
import type { LiveBlock } from "../shared/live-block"
import type { LiveBlockHub } from "./live-block-throttle"
import type { ResolvedAppSettings } from "./ws-router-defaults"
import type { EnvelopeBuilder } from "./ws-router-envelope"
import {
  countSubscriptionsByTopic,
  ensureChatOpSeqMap,
  ensureSnapshotSignatures,
  getStableChatSnapshotSignature,
  isSendToStartingProfilingEnabled,
  logSendToStartingProfile,
  send,
  shouldIncludeTopic,
} from "./ws-router-utils"
import { defaultSchedule } from "./service-bus/scheduler"
import { diffChatMeta } from "./chat-ops-diff"
import type { ChatMetaSignatures } from "./chat-ops-diff"
import type { ClientState, SnapshotBroadcastFilter, SnapshotComputationCache } from "./ws-router-utils"

export const ABANDONED_EMPTY_CHAT_GRACE_MS = 5_000

export interface BroadcastManagerDeps {
  agent: AgentCoordinator
  store: EventStore
  terminals: TerminalManager
  keybindings: KeybindingsManager
  resolvedAppSettings: ResolvedAppSettings
  updateManager: UpdateManager | null
  packageUpdateManager?: PackageUpdateManager
  workflowRegistry?: WorkflowRegistry
  boardRegistry?: BoardRegistry
  beaconRegistry?: BeaconRegistry
  backgroundTaskOutputRegistry?: BackgroundTaskOutputRegistry
  liveBlocks?: LiveBlockHub
  envelopeBuilder: EnvelopeBuilder
  scheduleChatCheck?: typeof defaultSchedule
}


export class BroadcastManager {
  private readonly sockets = new Set<ServerWebSocket<ClientState>>()
  private readonly metaSigsByChatId = new Map<string, ChatMetaSignatures>()
  private pendingBroadcastTimer: ReturnType<typeof setTimeout> | null = null
  private pendingBroadcastAll = false
  private readonly pendingBroadcastChatIds = new Set<string>()
  private readonly pendingAbandonedChatChecks = new Map<string, () => void>()

  private readonly disposeTerminalEvents: () => void
  private readonly disposeKeybindingEvents: () => void
  private readonly disposeAppSettingsEvents: () => void
  private readonly disposeUpdateEvents: () => void
  private readonly disposeWorkflows: () => void
  private readonly disposeBoards: () => void
  private readonly disposeBeacons: () => void
  private readonly disposeBackgroundTaskOutput: () => void
  private readonly disposePackageUpdateEvents: () => void
  private readonly disposeLiveBlocks: () => void

  constructor(private readonly deps: BroadcastManagerDeps) {
    const {
      agent,
      terminals,
      keybindings,
      resolvedAppSettings,
      updateManager,
      packageUpdateManager,
      workflowRegistry,
      boardRegistry,
      beaconRegistry,
      backgroundTaskOutputRegistry,
      liveBlocks,
    } = deps

    agent.setBackgroundErrorReporter?.(this.broadcastError.bind(this))

    this.disposeTerminalEvents = terminals.onEvent((event) => {
      this.pushTerminalEvent(event.terminalId, event)
    })

    this.disposeLiveBlocks = liveBlocks?.subscribe((chatId, block) => {
      this.pushLiveBlock(chatId, block)
    }) ?? (() => {})

    this.disposeKeybindingEvents = keybindings.onChange(() => {
      this.pushMatching((topic) => topic.type === "keybindings")
    })

    this.disposeAppSettingsEvents = resolvedAppSettings.onChange(() => {
      this.pushMatching((topic) => topic.type === "app-settings" || topic.type === "beacons")
    })

    this.disposeUpdateEvents = updateManager?.onChange(() => {
      this.pushMatching((topic) => topic.type === "update")
    }) ?? (() => {})

    this.disposeWorkflows = workflowRegistry?.subscribe((chatId) => {
      this.pushMatching((topic) => topic.type === "workflows" && topic.chatId === chatId)
      this.scheduleChatStateBroadcast(chatId)
    }) ?? (() => {})

    this.disposeBoards = boardRegistry?.subscribe((change: BoardChange) => {
      this.pushMatching((topic) =>
        (topic.type === "board" && topic.boardId === change.boardId)
        || (topic.type === "boards" && topic.ownerKind === change.owner.kind && topic.ownerId === change.owner.id))
    }) ?? (() => {})

    this.disposeBeacons = beaconRegistry?.subscribe(() => {
      this.pushMatching((topic) => topic.type === "beacons")
    }) ?? (() => {})

    this.disposeBackgroundTaskOutput = backgroundTaskOutputRegistry?.subscribe((chatId, taskId) => {
      this.pushMatching((topic) =>
        topic.type === "background-task-output" && topic.chatId === chatId && topic.taskId === taskId)
    }) ?? (() => {})

    this.disposePackageUpdateEvents = packageUpdateManager?.onChange(() => {
      this.pushMatching((topic) => topic.type === "package-updates")
    }) ?? (() => {})
  }


  addSocket(ws: ServerWebSocket<ClientState>): void {
    this.sockets.add(ws)
  }

  removeSocket(ws: ServerWebSocket<ClientState>): void {
    this.sockets.delete(ws)
  }


  getProtectedChatIds(): Set<string> {
    const { agent } = this.deps
    const activeStatuses = agent.getActiveStatuses()
    return new Set([
      ...activeStatuses.keys(),
      ...agent.getDrainingChatIds().values(),
    ])
  }

  getProtectedDraftChatIds(extraSockets?: Iterable<ServerWebSocket<ClientState>>): Set<string> {
    const protectedChatIds = new Set<string>()

    for (const socket of this.sockets) {
      for (const chatId of socket.data.protectedDraftChatIds ?? []) {
        protectedChatIds.add(chatId)
      }
    }

    for (const socket of extraSockets ?? []) {
      for (const chatId of socket.data.protectedDraftChatIds ?? []) {
        protectedChatIds.add(chatId)
      }
    }

    return protectedChatIds
  }

  private getViewedChatIds(extraSockets?: Iterable<ServerWebSocket<ClientState>>): Set<string> {
    const viewedChatIds = new Set<string>()
    for (const socket of [...this.sockets, ...(extraSockets ?? [])]) {
      for (const topic of socket.data.subscriptions.values()) {
        if (topic.type === "chat") viewedChatIds.add(topic.chatId)
      }
    }
    return viewedChatIds
  }

  releaseChatViewer(chatId: string): void {
    if (this.pendingAbandonedChatChecks.has(chatId)) return
    const schedule = this.deps.scheduleChatCheck ?? defaultSchedule
    const cancel = schedule(() => {
      this.pendingAbandonedChatChecks.delete(chatId)
      this.pruneAbandonedChat(chatId).catch((error) => {
        log.warn("[kanna/ws] abandoned empty chat check failed", toError(error).message)
      })
    }, ABANDONED_EMPTY_CHAT_GRACE_MS)
    this.pendingAbandonedChatChecks.set(chatId, cancel)
  }

  private async pruneAbandonedChat(chatId: string): Promise<void> {
    const { store } = this.deps
    const viewedChatIds = this.getViewedChatIds()
    if (viewedChatIds.has(chatId)) return
    const prunedChatIds = await store.pruneStaleEmptyChats({
      onlyChatIds: [chatId],
      maxAgeMs: 0,
      activeChatIds: this.getProtectedChatIds(),
      protectedChatIds: new Set([...this.getProtectedDraftChatIds(), ...viewedChatIds]),
    })
    if (prunedChatIds.length > 0) {
      await this.broadcastFilteredSnapshots({ includeSidebar: true })
    }
  }

  async maybePruneStaleEmptyChats(extraSockets?: Iterable<ServerWebSocket<ClientState>>): Promise<void> {
    const { store } = this.deps
    const startedAt = performance.now()
    const activeChatIds = this.getProtectedChatIds()
    const protectedDraftChatIds = this.getProtectedDraftChatIds(extraSockets)
    const prunedChatIds = await store.pruneStaleEmptyChats?.({
      activeChatIds,
      protectedChatIds: new Set([...protectedDraftChatIds, ...this.getViewedChatIds(extraSockets)]),
    })
    if (isSendToStartingProfilingEnabled()) {
      log.info("[kanna/send->starting][server]", JSON.stringify({
        stage: "ws.prune_stale_empty_chats",
        elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
        activeChatCount: activeChatIds.size,
        protectedDraftChatCount: protectedDraftChatIds.size,
        prunedCount: prunedChatIds?.length ?? 0,
        totalChatCount: store.state.chatsById.size,
        totalProjectCount: store.state.projectsById.size,
      }))
    }
  }


  private recordMetaOps(chatId: string, cache?: SnapshotComputationCache): void {
    const { store, envelopeBuilder } = this.deps
    if (cache) {
      cache.chatMetaOpsRecordedChatIds ??= new Set()
      if (cache.chatMetaOpsRecordedChatIds.has(chatId)) return
      cache.chatMetaOpsRecordedChatIds.add(chatId)
    }
    const meta = envelopeBuilder.deriveChatMeta(chatId)
    if (!meta) return
    const { ops, next } = diffChatMeta(this.metaSigsByChatId.get(chatId), meta)
    this.metaSigsByChatId.set(chatId, next)
    for (const op of ops) {
      store.chatOps.record(chatId, op)
    }
  }


  async pushSnapshots(
    ws: ServerWebSocket<ClientState>,
    options?: { skipPrune?: boolean; filter?: SnapshotBroadcastFilter; cache?: SnapshotComputationCache }
  ): Promise<void> {
    const { agent } = this.deps
    const pushStartedAt = performance.now()
    if (!options?.skipPrune) {
      await this.maybePruneStaleEmptyChats([ws])
    }
    const snapshotSignatures = ensureSnapshotSignatures(ws)
    let sentCount = 0
    let skippedCount = 0
    for (const [id, topic] of ws.data.subscriptions.entries()) {
      if (!shouldIncludeTopic(topic, options?.filter)) {
        continue
      }
      if (topic.type === "chat") {
        const seqMap = ensureChatOpSeqMap(ws)
        const tracked = seqMap.get(id)
        if (tracked !== undefined) {
          this.recordMetaOps(topic.chatId, options?.cache)
          const batch = this.deps.store.chatOps.since(topic.chatId, tracked)
          if (batch !== null) {
            if (batch.ops.length === 0) {
              skippedCount += 1
              continue
            }
            seqMap.set(id, batch.toSeq)
            send(ws, {
              v: PROTOCOL_VERSION,
              type: "event",
              id,
              event: {
                type: "chat.ops",
                chatId: topic.chatId,
                fromSeq: batch.fromSeq,
                toSeq: batch.toSeq,
                ops: batch.ops,
              },
            })
            sentCount += 1
            continue
          }
          seqMap.delete(id)
          snapshotSignatures.delete(id)
        }
      }
      const envelopeStartedAt = performance.now()
      const envelope = this.deps.envelopeBuilder.createEnvelope(id, topic, options?.cache, ws)
      const createdAt = performance.now()
      if (envelope.type !== "snapshot") continue
      const signature = topic.type === "sidebar"
        ? this.deps.envelopeBuilder.getSidebarSnapshotCacheEntry(options?.cache).signature
        : getStableChatSnapshotSignature(envelope.snapshot)
      const signatureReadyAt = topic.type === "sidebar" ? createdAt : performance.now()
      if (snapshotSignatures.get(id) === signature) {
        skippedCount += 1
        continue
      }
      snapshotSignatures.set(id, signature)
      if (topic.type === "chat" && envelope.snapshot.type === "chat" && envelope.snapshot.data?.runtime.status === "starting") {
        const profile = agent.getActiveTurnProfile(topic.chatId)
        logSendToStartingProfile(profile?.traceId, profile?.startedAt, "ws.snapshot_sent", {
          chatId: topic.chatId,
          status: envelope.snapshot.data.runtime.status,
          messageCount: envelope.snapshot.data.messages.length,
          buildMs: Number((createdAt - envelopeStartedAt).toFixed(1)),
          signatureMs: Number((signatureReadyAt - createdAt).toFixed(1)),
          signatureBytes: signature.length,
        })
      }
      const payloadBytes = send(ws, envelope)
      sentCount += 1
      if (topic.type === "chat" && envelope.snapshot.type === "chat") {
        const dataSeq = envelope.snapshot.data?.seq
        if (dataSeq !== undefined) {
          ensureChatOpSeqMap(ws).set(id, dataSeq)
        }
      }
      if (topic.type === "chat" && envelope.snapshot.type === "chat" && envelope.snapshot.data?.runtime.status === "starting") {
        const profile = agent.getActiveTurnProfile(topic.chatId)
        logSendToStartingProfile(profile?.traceId, profile?.startedAt, "ws.snapshot_send_completed", {
          chatId: topic.chatId,
          payloadBytes,
        })
      }
    }
    if (isSendToStartingProfilingEnabled()) {
      log.info("[kanna/send->starting][server]", JSON.stringify({
        stage: "ws.push_snapshots_completed",
        elapsedMs: Number((performance.now() - pushStartedAt).toFixed(1)),
        skipPrune: Boolean(options?.skipPrune),
        sentCount,
        skippedCount,
        ...countSubscriptionsByTopic(ws),
      }))
    }
  }


  async broadcastSnapshots(): Promise<void> {
    const { store } = this.deps
    const startedAt = performance.now()
    let socketCount = 0
    const cache: SnapshotComputationCache = {}
    for (const ws of this.sockets) {
      socketCount += 1
      await this.pushSnapshots(ws, { skipPrune: true, cache })
    }
    if (isSendToStartingProfilingEnabled()) {
      log.info("[kanna/send->starting][server]", JSON.stringify({
        stage: "ws.broadcast_snapshots_completed",
        elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
        pruneMs: 0,
        socketCount,
        totalChatCount: store.state.chatsById.size,
        totalProjectCount: store.state.projectsById.size,
      }))
    }
  }

  async broadcastFilteredSnapshots(filter: SnapshotBroadcastFilter): Promise<void> {
    const startedAt = performance.now()
    let socketCount = 0
    const cache: SnapshotComputationCache = {}
    for (const ws of this.sockets) {
      socketCount += 1
      await this.pushSnapshots(ws, { skipPrune: true, filter, cache })
    }
    if (isSendToStartingProfilingEnabled()) {
      log.info("[kanna/send->starting][server]", JSON.stringify({
        stage: "ws.broadcast_filtered_snapshots_completed",
        elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
        socketCount,
        includeSidebar: Boolean(filter.includeSidebar),
        chatCount: filter.chatIds?.size ?? 0,
        projectCount: filter.projectIds?.size ?? 0,
      }))
    }
  }

  scheduleBroadcast(): void {
    this.pendingBroadcastAll = true
    this.pendingBroadcastChatIds.clear()
    this.armBroadcastTimer()
  }

  scheduleChatStateBroadcast(chatId: string): void {
    if (!this.pendingBroadcastAll) {
      this.pendingBroadcastChatIds.add(chatId)
    }
    this.armBroadcastTimer()
  }

  private armBroadcastTimer(): void {
    if (this.pendingBroadcastTimer) {
      return
    }
    this.pendingBroadcastTimer = setTimeout(() => this.flushPendingBroadcast(), 16)
  }

  private flushPendingBroadcast(): void {
    this.pendingBroadcastTimer = null
    const shouldBroadcastAll = this.pendingBroadcastAll
    const chatIds = new Set(this.pendingBroadcastChatIds)
    this.pendingBroadcastAll = false
    this.pendingBroadcastChatIds.clear()
    if (shouldBroadcastAll) {
      void this.broadcastSnapshots()
      return
    }
    if (chatIds.size > 0) {
      void this.broadcastFilteredSnapshots({
        includeSidebar: true,
        chatIds,
      })
    }
  }

  async broadcastChatAndSidebar(chatId: string): Promise<void> {
    await this.broadcastFilteredSnapshots({
      includeSidebar: true,
      chatIds: new Set([chatId]),
    })
  }

  broadcastError(message: string): void {
    for (const ws of this.sockets) {
      send(ws, {
        v: PROTOCOL_VERSION,
        type: "error",
        message,
      })
    }
  }


  pushTerminalSnapshot(terminalId: string): void {
    this.pushMatching((topic) => topic.type === "terminal" && topic.terminalId === terminalId)
  }

  pushTerminalEvent(
    terminalId: string,
    event: Extract<ServerEnvelope, { type: "event" }>["event"]
  ): void {
    for (const ws of this.sockets) {
      for (const [id, topic] of ws.data.subscriptions.entries()) {
        if (topic.type !== "terminal" || topic.terminalId !== terminalId) continue
        send(ws, {
          v: PROTOCOL_VERSION,
          type: "event",
          id,
          event,
        })
      }
    }
  }

  pushLiveBlock(chatId: string, block: LiveBlock | null): void {
    for (const ws of this.sockets) {
      for (const [id, topic] of ws.data.subscriptions.entries()) {
        if (topic.type !== "chat" || topic.chatId !== chatId) continue
        this.sendLiveBlock(ws, id, chatId, block)
      }
    }
  }

  pushLatestLiveBlock(ws: ServerWebSocket<ClientState>, subscriptionId: string, chatId: string): void {
    const block = this.deps.liveBlocks?.latest(chatId) ?? null
    if (block !== null) this.sendLiveBlock(ws, subscriptionId, chatId, block)
  }

  private sendLiveBlock(
    ws: ServerWebSocket<ClientState>,
    subscriptionId: string,
    chatId: string,
    block: LiveBlock | null,
  ): void {
    send(ws, {
      v: PROTOCOL_VERSION,
      type: "event",
      id: subscriptionId,
      event: { type: "chat.live", chatId, block },
    })
  }

  pushFollowedSessions(): void {
    this.pushTopic("followed-sessions")
  }

  pushCronJobs(): void {
    this.pushTopic("cron-jobs")
  }

  pushWebhooks(): void {
    this.pushTopic("webhooks")
  }

  pushInbox(): void {
    this.pushTopic("inbox")
  }

  pushMcpSources(): void {
    this.pushTopic("mcp-sources")
  }

  pushServiceBus(): void {
    this.pushTopic("service-bus")
  }

  private pushTopic(topicType: "followed-sessions" | "cron-jobs" | "webhooks" | "inbox" | "mcp-sources" | "service-bus"): void {
    this.pushMatching((topic) => topic.type === topicType)
  }

  private pushMatching(match: (topic: SubscriptionTopic) => boolean): void {
    for (const ws of this.sockets) {
      const snapshotSignatures = ensureSnapshotSignatures(ws)
      for (const [id, topic] of ws.data.subscriptions.entries()) {
        if (!match(topic)) continue
        const envelope = this.deps.envelopeBuilder.createEnvelope(id, topic, undefined, ws)
        if (envelope.type !== "snapshot") continue
        const signature = JSON.stringify(envelope.snapshot)
        if (snapshotSignatures.get(id) === signature) continue
        snapshotSignatures.set(id, signature)
        send(ws, envelope)
      }
    }
  }


  dispose(): void {
    if (this.pendingBroadcastTimer) {
      clearTimeout(this.pendingBroadcastTimer)
      this.pendingBroadcastTimer = null
    }
    for (const cancel of this.pendingAbandonedChatChecks.values()) cancel()
    this.pendingAbandonedChatChecks.clear()
    this.deps.agent.setBackgroundErrorReporter?.(null)
    this.disposeTerminalEvents()
    this.disposeKeybindingEvents()
    this.disposeAppSettingsEvents()
    this.disposeUpdateEvents()
    this.disposeWorkflows()
    this.disposeBoards()
    this.disposeBeacons()
    this.disposeBackgroundTaskOutput()
    this.disposePackageUpdateEvents()
    this.disposeLiveBlocks()
  }
}
