/**
 * ws-router-broadcast.ts
 *
 * BroadcastManager — owns the connected-socket set, pending-broadcast state,
 * and all snapshot-push / broadcast methods. Wires event subscriptions
 * (terminals, keybindings, appSettings, update, ptyInstances, workflows, orch)
 * and exposes a `dispose()` to tear them down.
 *
 * Extracted from ws-router.ts to reduce its size.
 */
import { log } from "../shared/log"
import { PROTOCOL_VERSION } from "../shared/types"
import type { ServerWebSocket } from "bun"
import type { PtyInstanceDelta } from "../shared/pty-instance"
import type { PtyInstanceRegistry } from "./claude-pty/pty-instance-registry"
import type { WorkflowRegistry } from "./workflow-registry"
import type { EventStore } from "./event-store"
import type { AgentCoordinator } from "./agent"
import type { TerminalManager } from "./terminal-manager"
import type { KeybindingsManager } from "./keybindings"
import type { UpdateManager } from "./update-manager"
import type { ServerEnvelope } from "../shared/protocol"
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
import { diffChatMeta } from "./chat-ops-diff"
import type { ChatMetaSignatures } from "./chat-ops-diff"
import type { ClientState, SnapshotBroadcastFilter, SnapshotComputationCache } from "./ws-router-utils"

// ── Deps ──────────────────────────────────────────────────────────────────────

export interface BroadcastManagerDeps {
  agent: AgentCoordinator
  store: EventStore
  terminals: TerminalManager
  keybindings: KeybindingsManager
  resolvedAppSettings: ResolvedAppSettings
  updateManager: UpdateManager | null
  ptyInstances?: PtyInstanceRegistry
  workflowRegistry?: WorkflowRegistry
  envelopeBuilder: EnvelopeBuilder
}

// ── BroadcastManager ─────────────────────────────────────────────────────────

export class BroadcastManager {
  private readonly sockets = new Set<ServerWebSocket<ClientState>>()
  /** Last-recorded meta signatures per chat for the chat.ops diff. */
  private readonly metaSigsByChatId = new Map<string, ChatMetaSignatures>()
  private pendingBroadcastTimer: ReturnType<typeof setTimeout> | null = null
  private pendingBroadcastAll = false
  private readonly pendingBroadcastChatIds = new Set<string>()

  private readonly disposeTerminalEvents: () => void
  private readonly disposeKeybindingEvents: () => void
  private readonly disposeAppSettingsEvents: () => void
  private readonly disposeUpdateEvents: () => void
  private readonly disposePtyInstances: () => void
  private readonly disposeWorkflows: () => void
  private readonly disposeOrchRuns: () => void

  constructor(private readonly deps: BroadcastManagerDeps) {
    const {
      agent,
      terminals,
      keybindings,
      resolvedAppSettings,
      updateManager,
      ptyInstances,
      workflowRegistry,
      store,
    } = deps

    // Wire background error reporter
    agent.setBackgroundErrorReporter?.(this.broadcastError.bind(this))

    // Terminal events
    this.disposeTerminalEvents = terminals.onEvent((event) => {
      this.pushTerminalEvent(event.terminalId, event)
    })

    // Keybinding snapshot push on change
    this.disposeKeybindingEvents = keybindings.onChange(() => {
      for (const ws of this.sockets) {
        const snapshotSignatures = ensureSnapshotSignatures(ws)
        for (const [id, topic] of ws.data.subscriptions.entries()) {
          if (topic.type !== "keybindings") continue
          const envelope = deps.envelopeBuilder.createEnvelope(id, topic, undefined, ws)
          if (envelope.type !== "snapshot") continue
          const signature = JSON.stringify(envelope.snapshot)
          if (snapshotSignatures.get(id) === signature) continue
          snapshotSignatures.set(id, signature)
          send(ws, envelope)
        }
      }
    })

    // App-settings snapshot push on change
    this.disposeAppSettingsEvents = resolvedAppSettings.onChange(() => {
      for (const ws of this.sockets) {
        const snapshotSignatures = ensureSnapshotSignatures(ws)
        for (const [id, topic] of ws.data.subscriptions.entries()) {
          if (topic.type !== "app-settings") continue
          const envelope = deps.envelopeBuilder.createEnvelope(id, topic, undefined, ws)
          if (envelope.type !== "snapshot") continue
          const signature = JSON.stringify(envelope.snapshot)
          if (snapshotSignatures.get(id) === signature) continue
          snapshotSignatures.set(id, signature)
          send(ws, envelope)
        }
      }
    })

    // Update snapshot push on change
    this.disposeUpdateEvents = updateManager?.onChange(() => {
      for (const ws of this.sockets) {
        const snapshotSignatures = ensureSnapshotSignatures(ws)
        for (const [id, topic] of ws.data.subscriptions.entries()) {
          if (topic.type !== "update") continue
          const envelope = deps.envelopeBuilder.createEnvelope(id, topic, undefined, ws)
          if (envelope.type !== "snapshot") continue
          const signature = JSON.stringify(envelope.snapshot)
          if (snapshotSignatures.get(id) === signature) continue
          snapshotSignatures.set(id, signature)
          send(ws, envelope)
        }
      }
    }) ?? (() => {})

    // PTY instance events
    this.disposePtyInstances = ptyInstances?.subscribe((delta: PtyInstanceDelta) => {
      if (delta.type === "added") {
        this.pushPtyInstancesEvent({ type: "pty-instances.added", instance: delta.instance })
      } else if (delta.type === "updated") {
        this.pushPtyInstancesEvent({ type: "pty-instances.updated", instance: delta.instance })
      } else {
        this.pushPtyInstancesEvent({ type: "pty-instances.removed", chatId: delta.chatId })
      }
    }) ?? (() => {})

    // Workflow snapshot push on change
    this.disposeWorkflows = workflowRegistry?.subscribe((chatId) => {
      for (const ws of this.sockets) {
        const snapshotSignatures = ensureSnapshotSignatures(ws)
        for (const [id, topic] of ws.data.subscriptions.entries()) {
          if (topic.type !== "workflows" || topic.chatId !== chatId) continue
          const envelope = deps.envelopeBuilder.createEnvelope(id, topic, undefined, ws)
          if (envelope.type !== "snapshot") continue
          const signature = JSON.stringify(envelope.snapshot)
          if (snapshotSignatures.get(id) === signature) continue
          snapshotSignatures.set(id, signature)
          send(ws, envelope)
        }
      }
    }) ?? (() => {})

    // Orchestration run pushes
    // Optional like the registry subscriptions above: partial store fakes in
    // tests may not implement it. The real EventStore always does.
    this.disposeOrchRuns = typeof store.subscribeOrchRuns === "function"
      ? store.subscribeOrchRuns(() => this.pushOrchRuns())
      : () => {}
  }

  // ── Socket lifecycle ────────────────────────────────────────────────────────

  addSocket(ws: ServerWebSocket<ClientState>): void {
    this.sockets.add(ws)
  }

  removeSocket(ws: ServerWebSocket<ClientState>): void {
    this.sockets.delete(ws)
  }

  // ── Protected-chat helpers ──────────────────────────────────────────────────

  getProtectedChatIds(): Set<string> {
    const { agent } = this.deps
    const activeStatuses = agent.getActiveStatuses()
    const drainingChatIds = typeof agent.getDrainingChatIds === "function"
      ? agent.getDrainingChatIds()
      : new Set<string>()
    return new Set([
      ...activeStatuses.keys(),
      ...drainingChatIds.values(),
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

  async maybePruneStaleEmptyChats(extraSockets?: Iterable<ServerWebSocket<ClientState>>): Promise<void> {
    const { store } = this.deps
    const startedAt = performance.now()
    const activeChatIds = this.getProtectedChatIds()
    const protectedDraftChatIds = this.getProtectedDraftChatIds(extraSockets)
    const prunedChatIds = await store.pruneStaleEmptyChats?.({
      activeChatIds,
      protectedChatIds: protectedDraftChatIds,
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

  // ── Chat ops (delta) path ───────────────────────────────────────────────────

  /**
   * Records runtime/section/pending delta ops for a chat into the op-log
   * (once per broadcast pass — deduped via the shared computation cache).
   * Ordering authority is the op-log itself: subscribers only ever read
   * batches out of `chatOps.since`.
   */
  private recordMetaOps(chatId: string, cache?: SnapshotComputationCache): void {
    const { store, envelopeBuilder } = this.deps
    if (typeof store.chatOps?.record !== "function") return
    if (typeof envelopeBuilder.deriveChatMeta !== "function") return
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

  // ── Snapshot push ───────────────────────────────────────────────────────────

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
      if (topic.type === "chat" && typeof this.deps.store.chatOps?.since === "function") {
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
          // Ring gap — drop tracking AND the snapshot signature so the
          // fallback full snapshot below always sends and re-arms the
          // delta path (a signature-dedup skip here would strand the
          // subscriber outside both paths).
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

  // ── Broadcast ───────────────────────────────────────────────────────────────

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
    if (this.pendingBroadcastTimer) {
      return
    }
    this.pendingBroadcastTimer = setTimeout(() => {
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
    }, 16)
  }

  scheduleChatStateBroadcast(chatId: string): void {
    if (!this.pendingBroadcastAll) {
      this.pendingBroadcastChatIds.add(chatId)
    }
    if (this.pendingBroadcastTimer) {
      return
    }
    this.pendingBroadcastTimer = setTimeout(() => {
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
    }, 16)
  }

  async broadcastChatAndSidebar(chatId: string): Promise<void> {
    await this.broadcastFilteredSnapshots({
      includeSidebar: true,
      chatIds: new Set([chatId]),
    })
  }

  async broadcastChatStateImmediately(chatId: string): Promise<void> {
    await this.broadcastChatAndSidebar(chatId)
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

  // ── Per-topic targeted pushes ───────────────────────────────────────────────

  pushTerminalSnapshot(terminalId: string): void {
    for (const ws of this.sockets) {
      const snapshotSignatures = ensureSnapshotSignatures(ws)
      for (const [id, topic] of ws.data.subscriptions.entries()) {
        if (topic.type !== "terminal" || topic.terminalId !== terminalId) continue
        const envelope = this.deps.envelopeBuilder.createEnvelope(id, topic, undefined, ws)
        if (envelope.type !== "snapshot") continue
        const signature = JSON.stringify(envelope.snapshot)
        if (snapshotSignatures.get(id) === signature) continue
        snapshotSignatures.set(id, signature)
        send(ws, envelope)
      }
    }
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

  private pushPtyInstancesEvent(
    event: Extract<ServerEnvelope, { type: "event" }>["event"]
  ): void {
    for (const ws of this.sockets) {
      for (const [id, topic] of ws.data.subscriptions.entries()) {
        if (topic.type !== "pty-instances") continue
        send(ws, { v: PROTOCOL_VERSION, type: "event", id, event })
      }
    }
  }

  private pushOrchRuns(): void {
    for (const ws of this.sockets) {
      const snapshotSignatures = ensureSnapshotSignatures(ws)
      for (const [id, topic] of ws.data.subscriptions.entries()) {
        if (topic.type !== "orch-runs") continue
        const envelope = this.deps.envelopeBuilder.createEnvelope(id, topic, undefined, ws)
        if (envelope.type !== "snapshot") continue
        const signature = JSON.stringify(envelope.snapshot)
        if (snapshotSignatures.get(id) === signature) continue
        snapshotSignatures.set(id, signature)
        send(ws, envelope)
      }
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  dispose(): void {
    if (this.pendingBroadcastTimer) {
      clearTimeout(this.pendingBroadcastTimer)
      this.pendingBroadcastTimer = null
    }
    this.deps.agent.setBackgroundErrorReporter?.(null)
    this.disposeTerminalEvents()
    this.disposeKeybindingEvents()
    this.disposeAppSettingsEvents()
    this.disposeUpdateEvents()
    this.disposePtyInstances()
    this.disposeWorkflows()
    this.disposeOrchRuns()
  }
}
