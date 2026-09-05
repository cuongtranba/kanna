import crypto from "node:crypto"
import { LOG_PREFIX } from "../shared/branding"
import { log } from "../shared/log"
import {
  addCounter,
  recordHistogram,
  withSpan,
  SUBAGENT_RUN_DURATION_MS,
  SUBAGENT_RUN_FINISHED,
  SUBAGENT_TOKENS,
} from "./observability"
import { splitBilledTokens } from "../shared/token-pricing"
import { deriveChunkLabel } from "../shared/loop-progress"
import type {
  AgentProvider,
  ProviderUsage,
  Subagent,
  SubagentErrorCode,
  TranscriptEntry,
} from "../shared/types"
import type { EventStore } from "./event-store"
import { buildHistoryPrimer, extractPreviousAssistantReply } from "./history-primer"
import { parseMentions, type ParsedMention } from "./mention-parser"

export class PausableTimeout {
  remainingMs: number
  private readonly totalMs: number
  private deadline: number | null = null
  private handle: ReturnType<typeof setTimeout> | null = null
  private onFire: () => void

  constructor(totalMs: number, onFire: () => void) {
    this.totalMs = totalMs
    this.remainingMs = totalMs
    this.onFire = onFire
  }

  start(now: number = Date.now()): void {
    this.deadline = now + this.remainingMs
    this.handle = setTimeout(this.onFire, this.remainingMs)
  }

  pause(now: number = Date.now()): void {
    if (this.handle == null || this.deadline == null) return
    clearTimeout(this.handle)
    this.handle = null
    this.remainingMs = Math.max(0, this.deadline - now)
    this.deadline = null
  }

  resume(now: number = Date.now()): void {
    if (this.handle != null) return
    this.start(now)
  }

  reset(now: number = Date.now()): void {
    if (this.handle == null) return
    this.remainingMs = this.totalMs
    clearTimeout(this.handle)
    this.deadline = now + this.remainingMs
    this.handle = setTimeout(this.onFire, this.remainingMs)
  }

  clear(): void {
    if (this.handle != null) clearTimeout(this.handle)
    this.handle = null
    this.deadline = null
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: Error) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (err: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

export interface LiveTurnSource {
  runTurn(
    prompt: string,
    onChunk: (c: string) => void,
    onEntry: (e: TranscriptEntry) => void,
  ): Promise<{ text: string; usage?: ProviderUsage }>
  close(): Promise<void>
}

export interface ProviderRunStart {
  provider: AgentProvider
  model: string
  systemPrompt: string
  preamble: string | null
  maxTurns?: number
  nativeMaxTurns?: boolean
  start: (
    onChunk: (chunk: string) => void,
    onEntry: (entry: TranscriptEntry) => void,
    opts?: { keepAlive?: boolean },
  ) => Promise<{ text: string; usage?: ProviderUsage; live?: LiveTurnSource }>
  authReady: () => Promise<boolean>
}

export interface OrchestratorAppSettings {
  getSnapshot(): { subagents: Subagent[] }
}

export interface SubagentOrchestratorDeps {
  store: EventStore
  appSettings: OrchestratorAppSettings
  startProviderRun: (args: {
    subagent: Subagent
    chatId: string
    primer: string | null
    userInstruction: string | null
    runId: string
    abortSignal: AbortSignal
    depth: number
    ancestorSubagentIds: string[]
    parentUserMessageId: string
  }) => ProviderRunStart
  onRunTerminal?: (chatId: string, runId: string, reason: "failed" | "completed") => void
  onRunProgress?: (chatId: string, runId: string) => void
  onBackgroundRunComplete?: (chatId: string, runId: string, outcome: BackgroundRunOutcome) => void
  now?: () => number
  maxParallel?: number
  maxChainDepth?: number
  runTimeoutMs?: number
  maxLive?: number
  liveIdleTimeoutMs?: number
}

const DEFAULT_MAX_PARALLEL = 4
const DEFAULT_MAX_CHAIN_DEPTH = 1
const DEFAULT_MAX_LIVE = 5
const DEFAULT_LIVE_IDLE_TIMEOUT_MS = 300_000

export type DelegationOutcome =
  | { status: "completed"; runId: string; text: string }
  | { status: "failed"; runId: string; errorCode: SubagentErrorCode; errorMessage: string }
  | { status: "async_launched"; runId: string }

export type BackgroundRunOutcome =
  | { status: "completed"; runId: string; text: string }
  | { status: "failed"; runId: string; errorCode: SubagentErrorCode; errorMessage: string }
function recordSubagentSpend(provider: AgentProvider, usage: ProviderUsage | undefined): void {
  if (!usage) return
  for (const [kind, count] of splitBilledTokens(usage)) {
    addCounter(SUBAGENT_TOKENS, count, { provider, kind })
  }
}

const DEFAULT_RUN_TIMEOUT_MS = 600_000
const SUBAGENT_HISTORY_PRIMER_TAIL_LIMIT = 1000

interface LiveSession {
  chatId: string
  runId: string
  subagentId: string
  parentRunId: string | null
  live: LiveTurnSource
  idleTimer: ReturnType<typeof setTimeout> | null
  lastActivity: number
}

interface RunState {
  chatId: string
  parentRunId: string | null
  childRunIds: Set<string>
  abortController: AbortController
  timeout: PausableTimeout | null
  cancelled: boolean
  pendingAcquire: boolean
  permitWaiter: { resolve: () => void; reject: (e: Error) => void } | null
}

export class SubagentOrchestrator {
  private permits: number
  private readonly waiters: Array<{ chatId: string; resolve: () => void; reject: (err: Error) => void }> = []
  private readonly cancelledChats = new Set<string>()
  private readonly runStateByRunId = new Map<string, RunState>()
  private readonly liveSessions = new Map<string, LiveSession>()

  private readonly recoveryPromise: Promise<void>

  constructor(private readonly deps: SubagentOrchestratorDeps) {
    this.permits = this.maxParallel()
    this.recoveryPromise = this.recoverInterruptedRuns()
  }

  whenRecovered(): Promise<void> {
    return this.recoveryPromise
  }

  private async recoverInterruptedRuns(): Promise<void> {
    for (const run of this.deps.store.runningSubagentRuns()) {
      try {
        await this.deps.store.appendSubagentEvent({
          v: 3,
          type: "subagent_run_failed",
          timestamp: this.now(),
          chatId: run.chatId,
          runId: run.runId,
          error: {
            code: "INTERRUPTED",
            message: run.pendingTool
              ? "Server restart while subagent awaited tool response"
              : "Server restart while subagent run was in progress",
          },
        })
      } catch (err) {
        log.warn(`${LOG_PREFIX} interrupted-run recovery failed`, {
          chatId: run.chatId, runId: run.runId, err,
        })
      }
    }
  }

  private maxParallel() { return this.deps.maxParallel ?? DEFAULT_MAX_PARALLEL }
  private maxDepth() { return this.deps.maxChainDepth ?? DEFAULT_MAX_CHAIN_DEPTH }
  private timeoutMs() { return this.deps.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS }
  private now() { return this.deps.now?.() ?? Date.now() }
  private maxLive() { return this.deps.maxLive ?? DEFAULT_MAX_LIVE }
  private idleTimeoutMs() { return this.deps.liveIdleTimeoutMs ?? DEFAULT_LIVE_IDLE_TIMEOUT_MS }

  liveSessionCount() { return this.liveSessions.size }

  private resolveSubagent(idOrName: string): Subagent | undefined {
    const subagents = this.deps.appSettings.getSnapshot().subagents
    const byId = subagents.find((s) => s.id === idOrName)
    if (byId) return byId
    const byName = subagents.filter((s) => s.name === idOrName)
    return byName.length === 1 ? byName[0] : undefined
  }

  findSubagent(id: string): Subagent | undefined {
    return this.resolveSubagent(id)
  }

  describeUnknownSubagent(requested: string): string {
    const subagents = this.deps.appSettings.getSnapshot().subagents
    if (subagents.length === 0) {
      return `Subagent "${requested}" not found. No subagents are configured — ask the user to create one in Settings → Subagents.`
    }
    const lines = subagents.map((s) =>
      `- ${s.name} [id=${s.id}]${s.triggerMode === "manual" ? " (manual — requires user @-mention)" : ""}`)
    return `Subagent "${requested}" not found. Available subagents:\n${lines.join("\n")}\nRetry with the exact id (or unique name) of one of these.`
  }

  activePermitCount() {
    return this.maxParallel() - this.permits
  }

  notifySubagentToolPending(runId: string): void {
    this.runStateByRunId.get(runId)?.timeout?.pause()
  }

  notifySubagentToolResolved(runId: string): void {
    this.runStateByRunId.get(runId)?.timeout?.resume()
  }

  private async acquire(chatId: string, runId: string): Promise<void> {
    if (this.cancelledChats.has(chatId)) {
      throw new Error("CHAT_CANCELLED")
    }
    if (this.permits > 0) {
      this.permits -= 1
      const state = this.runStateByRunId.get(runId)
      if (state) state.pendingAcquire = false
      return
    }
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    const state = this.runStateByRunId.get(runId)
    if (state) {
      state.permitWaiter = { resolve, reject }
    }
    this.waiters.push({ chatId, resolve, reject })
    try {
      await promise
    } finally {
      if (state) {
        state.permitWaiter = null
        state.pendingAcquire = false
      }
    }
  }

  private release(): void {
    const next = this.waiters.shift()
    if (next) {
      next.resolve()
      return
    }
    this.permits += 1
  }

  clearChatCancellation(chatId: string): void {
    this.cancelledChats.delete(chatId)
  }

  cancelChat(chatId: string): void {
    this.cancelledChats.add(chatId)
    for (let i = this.waiters.length - 1; i >= 0; i -= 1) {
      const w = this.waiters[i]
      if (w.chatId !== chatId) continue
      this.waiters.splice(i, 1)
      w.reject(new Error("CHAT_CANCELLED"))
    }
    const runIds: string[] = []
    for (const [runId, state] of this.runStateByRunId) {
      if (state.chatId === chatId) runIds.push(runId)
    }
    for (const runId of runIds) this.cancelRun(chatId, runId)
    for (const s of [...this.liveSessions.values()]) {
      if (s.chatId === chatId) void this.closeLiveRun(chatId, s.runId, "cancel")
    }
  }

  cancelRun(chatId: string, runId: string): void {
    const state = this.runStateByRunId.get(runId)
    if (!state) return
    if (state.cancelled) return
    if (state.chatId !== chatId) return
    state.cancelled = true
    for (const childRunId of [...state.childRunIds]) {
      this.cancelRun(chatId, childRunId)
    }
    if (state.pendingAcquire && state.permitWaiter) {
      const idx = this.waiters.findIndex((w) => w.resolve === state.permitWaiter!.resolve)
      if (idx >= 0) this.waiters.splice(idx, 1)
      const reject = state.permitWaiter.reject
      state.permitWaiter = null
      reject(new Error("USER_CANCELLED"))
    } else {
      state.abortController.abort()
    }
    if (this.liveSessions.has(runId)) {
      void this.closeLiveRun(chatId, runId, "cancel")
    }
  }

  async runMentionsForUserMessage(args: {
    chatId: string
    userMessageId: string
    mentions: ParsedMention[]
    userContent?: string
  }): Promise<void> {
    const userContent = args.userContent ?? ""
    this.cancelledChats.delete(args.chatId)
    await this.recoveryPromise
    const subagents = this.deps.appSettings.getSnapshot().subagents
    const resolved: { mention: Extract<ParsedMention, { kind: "subagent" }>; subagent: Subagent }[] = []

    for (const mention of args.mentions) {
      if (mention.kind === "unknown-subagent") {
        const runId = crypto.randomUUID()
        await this.deps.store.appendSubagentEvent({
          v: 3,
          type: "subagent_run_started",
          timestamp: this.now(),
          chatId: args.chatId,
          runId,
          subagentId: null,
          subagentName: mention.name,
          provider: "claude",
          model: "",
          parentUserMessageId: args.userMessageId,
          parentRunId: null,
          depth: 0,
        })
        await this.failRun(args.chatId, runId, "UNKNOWN_SUBAGENT", `Unknown subagent '${mention.name}'`)
        continue
      }
      const subagent = subagents.find((s) => s.id === mention.subagentId)
      if (!subagent) {
        const runId = crypto.randomUUID()
        await this.deps.store.appendSubagentEvent({
          v: 3,
          type: "subagent_run_started",
          timestamp: this.now(),
          chatId: args.chatId,
          runId,
          subagentId: mention.subagentId,
          subagentName: mention.subagentId,
          provider: "claude",
          model: "",
          parentUserMessageId: args.userMessageId,
          parentRunId: null,
          depth: 0,
        })
        await this.failRun(args.chatId, runId, "UNKNOWN_SUBAGENT", `Subagent ${mention.subagentId} was deleted`)
        continue
      }
      resolved.push({ mention, subagent })
    }

    await Promise.all(resolved.map(({ subagent }) =>
      this.spawnRun({
        subagent,
        chatId: args.chatId,
        parentUserMessageId: args.userMessageId,
        parentRunId: null,
        depth: 0,
        ancestorSubagentIds: [],
        userInstruction: userContent,
      })
    ))
  }

  async delegateRun(args: {
    chatId: string
    parentUserMessageId: string
    parentRunId: string | null
    parentSubagentId: string | null
    ancestorSubagentIds: string[]
    depth: number
    subagentId: string
    prompt: string
    label?: string
    mentionedSubagentIds: string[]
    onEntry?: (entry: TranscriptEntry) => void
    keepAlive?: boolean
    background?: boolean
  }): Promise<DelegationOutcome> {
    await this.recoveryPromise
    const subagent = this.resolveSubagent(args.subagentId)
    if (!subagent) {
      const runId = crypto.randomUUID()
      await this.deps.store.appendSubagentEvent({
        v: 3,
        type: "subagent_run_started",
        timestamp: this.now(),
        chatId: args.chatId,
        runId,
        subagentId: args.subagentId,
        subagentName: args.subagentId,
        provider: "claude",
        model: "",
        parentUserMessageId: args.parentUserMessageId,
        parentRunId: args.parentRunId,
        depth: args.depth,
      })
      return await this.failRun(args.chatId, runId, "UNKNOWN_SUBAGENT", this.describeUnknownSubagent(args.subagentId))
    }
    if (subagent.triggerMode === "manual" && !args.mentionedSubagentIds.includes(subagent.id)) {
      const runId = crypto.randomUUID()
      await this.deps.store.appendSubagentEvent({
        v: 3,
        type: "subagent_run_started",
        timestamp: this.now(),
        chatId: args.chatId,
        runId,
        subagentId: subagent.id,
        subagentName: subagent.name,
        provider: "claude",
        model: "",
        parentUserMessageId: args.parentUserMessageId,
        parentRunId: args.parentRunId,
        depth: args.depth,
      })
      return await this.failRun(
        args.chatId,
        runId,
        "MANUAL_ONLY",
        `Subagent ${subagent.name} is manual-trigger; the user must @-mention it to delegate`,
      )
    }
    if (args.depth > this.maxDepth()) {
      const runId = crypto.randomUUID()
      await this.deps.store.appendSubagentEvent({
        v: 3,
        type: "subagent_run_started",
        timestamp: this.now(),
        chatId: args.chatId,
        runId,
        subagentId: subagent.id,
        subagentName: subagent.name,
        provider: subagent.provider,
        model: subagent.model,
        parentUserMessageId: args.parentUserMessageId,
        parentRunId: args.parentRunId,
        depth: args.depth,
      })
      return await this.failRun(
        args.chatId,
        runId,
        "DEPTH_EXCEEDED",
        `Chain depth ${args.depth} exceeds limit ${this.maxDepth()}`,
      )
    }
    if (args.ancestorSubagentIds.includes(subagent.id)) {
      const runId = crypto.randomUUID()
      await this.deps.store.appendSubagentEvent({
        v: 3,
        type: "subagent_run_started",
        timestamp: this.now(),
        chatId: args.chatId,
        runId,
        subagentId: subagent.id,
        subagentName: subagent.name,
        provider: subagent.provider,
        model: subagent.model,
        parentUserMessageId: args.parentUserMessageId,
        parentRunId: args.parentRunId,
        depth: args.depth,
      })
      return await this.failRun(
        args.chatId,
        runId,
        "LOOP_DETECTED",
        `Subagent ${subagent.name} already in ancestor chain`,
      )
    }
    if (args.keepAlive) {
      const liveForChat = [...this.liveSessions.values()].filter((s) => s.chatId === args.chatId).length
      if (liveForChat >= this.maxLive()) {
        const runId = crypto.randomUUID()
        return await this.failRun(
          args.chatId,
          runId,
          "CAP_EXCEEDED",
          `Live session cap of ${this.maxLive()} reached for chat ${args.chatId}`,
        )
      }
    }
    if (args.background) {
      const runId = crypto.randomUUID()
      void this.spawnRun({
        subagent,
        chatId: args.chatId,
        parentUserMessageId: args.parentUserMessageId,
        parentRunId: args.parentRunId,
        depth: args.depth,
        ancestorSubagentIds: args.ancestorSubagentIds,
        userInstruction: args.prompt,
        label: args.label,
        onEntry: args.onEntry,
        runId,
      })
        .then((outcome) => {
          if (outcome.status === "async_launched") return
          try {
            this.deps.onBackgroundRunComplete?.(args.chatId, runId, outcome)
          } catch (err) {
            log.warn(`${LOG_PREFIX} onBackgroundRunComplete threw`, { chatId: args.chatId, runId, err })
          }
        })
        .catch((err) => {
          log.warn(`${LOG_PREFIX} background spawnRun rejected`, { chatId: args.chatId, runId, err })
        })
      return { status: "async_launched", runId }
    }
    const outcome = await this.spawnRun({
      subagent,
      chatId: args.chatId,
      parentUserMessageId: args.parentUserMessageId,
      parentRunId: args.parentRunId,
      depth: args.depth,
      ancestorSubagentIds: args.ancestorSubagentIds,
      userInstruction: args.prompt,
      label: args.label,
      onEntry: args.onEntry,
      keepAlive: args.keepAlive,
    })
    log.info("[kanna/subagent] delegateRun outcome", {
      chatId: args.chatId,
      subagentId: args.subagentId,
      parentRunId: args.parentRunId,
      depth: args.depth,
      status: outcome.status,
      errorCode: outcome.status === "failed" ? outcome.errorCode : undefined,
      textChars: outcome.status === "completed" ? outcome.text.length : undefined,
    })
    return outcome
  }

  private async spawnRun(args: {
    subagent: Subagent
    chatId: string
    parentUserMessageId: string
    parentRunId: string | null
    depth: number
    ancestorSubagentIds: string[]
    userInstruction: string
    label?: string
    onEntry?: (entry: TranscriptEntry) => void
    keepAlive?: boolean
    runId?: string
  }): Promise<DelegationOutcome> {
    const runId = args.runId ?? crypto.randomUUID()
    const startedAt = this.now()
    const outcome = await withSpan(
      "kanna.subagent.run",
      {
        "kanna.chat_id": args.chatId,
        "kanna.run_id": runId,
        "kanna.subagent_id": args.subagent.id,
        "kanna.subagent.provider": args.subagent.provider,
        "kanna.depth": args.depth,
      },
      (span) => this.spawnRunInner({ ...args, runId }).then((result) => {
        span.setAttribute("kanna.outcome", result.status)
        return result
      }),
    )
    addCounter(SUBAGENT_RUN_FINISHED, 1, { outcome: outcome.status })
    recordHistogram(SUBAGENT_RUN_DURATION_MS, this.now() - startedAt, {
      outcome: outcome.status,
      provider: args.subagent.provider,
    })
    return outcome
  }

  private async spawnRunInner(args: {
    subagent: Subagent
    chatId: string
    parentUserMessageId: string
    parentRunId: string | null
    depth: number
    ancestorSubagentIds: string[]
    userInstruction: string
    label?: string
    onEntry?: (entry: TranscriptEntry) => void
    keepAlive?: boolean
    runId: string
  }): Promise<DelegationOutcome> {
    const runId = args.runId
    const label = args.label?.trim() || deriveChunkLabel(args.userInstruction)
    await this.deps.store.appendSubagentEvent({
      v: 3,
      type: "subagent_run_started",
      timestamp: this.now(),
      chatId: args.chatId,
      runId,
      subagentId: args.subagent.id,
      subagentName: args.subagent.name,
      ...(label ? { label } : {}),
      provider: args.subagent.provider,
      model: args.subagent.model,
      parentUserMessageId: args.parentUserMessageId,
      parentRunId: args.parentRunId,
      depth: args.depth,
    })
    this.deps.onRunProgress?.(args.chatId, runId)

    const runState: RunState = {
      chatId: args.chatId,
      parentRunId: args.parentRunId,
      childRunIds: new Set(),
      abortController: new AbortController(),
      timeout: null,
      cancelled: false,
      pendingAcquire: true,
      permitWaiter: null,
    }
    this.runStateByRunId.set(runId, runState)
    if (args.parentRunId != null) {
      this.runStateByRunId.get(args.parentRunId)?.childRunIds.add(runId)
    }

    try {
      await this.acquire(args.chatId, runId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const code: SubagentErrorCode = msg === "USER_CANCELLED" ? "USER_CANCELLED" : "PROVIDER_ERROR"
      const message = msg === "USER_CANCELLED"
        ? "Cancelled before run started"
        : "Chat cancelled before run started"
      const outcome = await this.failRun(args.chatId, runId, code, message)
      this.cleanupRunState(runId)
      return outcome
    }
    let released = false
    const releaseSlot = () => {
      if (released) return
      released = true
      this.release()
    }

    if (this.cancelledChats.has(args.chatId)) {
      releaseSlot()
      const outcome = await this.failRun(args.chatId, runId, "PROVIDER_ERROR", "Chat cancelled before run started")
      this.cleanupRunState(runId)
      return outcome
    }

    try {
      let primer: string | null
      if (args.subagent.contextScope === "full-transcript") {
        primer = buildHistoryPrimer(this.deps.store.getRecentRawEntries(args.chatId, SUBAGENT_HISTORY_PRIMER_TAIL_LIMIT), args.subagent.provider, "")
      } else {
        const reply = extractPreviousAssistantReply(this.deps.store.getRecentRawEntries(args.chatId, 100))
        primer = reply == null ? null : `Previous assistant reply:\n${reply}`
      }

      let runStart: ProviderRunStart
      try {
        runStart = this.deps.startProviderRun({
          subagent: args.subagent,
          chatId: args.chatId,
          primer,
          userInstruction: args.userInstruction.length > 0 ? args.userInstruction : null,
          runId,
          abortSignal: runState.abortController.signal,
          depth: args.depth,
          ancestorSubagentIds: args.ancestorSubagentIds,
          parentUserMessageId: args.parentUserMessageId,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const outcome = await this.failRun(args.chatId, runId, "PROVIDER_ERROR", msg)
        releaseSlot()
        this.cleanupRunState(runId)
        return outcome
      }

      if (!(await runStart.authReady())) {
        const outcome = await this.failRun(args.chatId, runId, "AUTH_REQUIRED", `Authentication required for ${args.subagent.provider}`)
        releaseSlot()
        this.cleanupRunState(runId)
        return outcome
      }

      let finalText = ""
      let usage: ProviderUsage | undefined
      let liveHandle: LiveTurnSource | undefined
      let chunkProgressTimer: ReturnType<typeof setTimeout> | null = null
      const CHUNK_PROGRESS_THROTTLE_MS = 100

      const onChunk = (chunk: string) => {
        if (!chunk) return
        runState.timeout?.reset()
        this.deps.store
          .appendSubagentEvent({
            v: 3,
            type: "subagent_message_delta",
            timestamp: this.now(),
            chatId: args.chatId,
            runId,
            content: chunk,
          })
          .catch((err) => {
            log.warn(`${LOG_PREFIX} subagent delta append failed`, { chatId: args.chatId, runId, err })
          })
        if (chunkProgressTimer !== null) clearTimeout(chunkProgressTimer)
        chunkProgressTimer = setTimeout(() => {
          chunkProgressTimer = null
          this.deps.onRunProgress?.(args.chatId, runId)
        }, CHUNK_PROGRESS_THROTTLE_MS)
      }
      const hostMaxTurns = runStart.maxTurns !== undefined && runStart.maxTurns > 0 && !runStart.nativeMaxTurns
        ? runStart.maxTurns
        : null
      let toolCallCount = 0
      const maxTurnsRejection = createDeferred<never>()

      const externalOnEntry = args.onEntry
      const onEntry = (entry: TranscriptEntry) => {
        runState.timeout?.reset()
        if (hostMaxTurns !== null && entry.kind === "tool_call") {
          toolCallCount += 1
          if (toolCallCount > hostMaxTurns) {
            maxTurnsRejection.reject(new Error("MAX_TURNS"))
            runState.abortController.abort()
          }
        }
        this.deps.store
          .appendSubagentEvent({
            v: 3,
            type: "subagent_entry_appended",
            timestamp: this.now(),
            chatId: args.chatId,
            runId,
            entry,
          })
          .catch((err) => {
            log.warn(`${LOG_PREFIX} subagent entry append failed`, { chatId: args.chatId, runId, err })
          })
        this.deps.onRunProgress?.(args.chatId, runId)
        if (externalOnEntry) {
          try {
            externalOnEntry(entry)
          } catch (err) {
            log.warn(`${LOG_PREFIX} external onEntry threw`, { chatId: args.chatId, runId, err })
          }
        }
      }
      const timeoutRejection = createDeferred<never>()
      const pausable = new PausableTimeout(this.timeoutMs(), () => {
        timeoutRejection.reject(new Error("TIMEOUT"))
        runState.abortController.abort()
      })
      runState.timeout = pausable
      pausable.start()
      try {
        const abortRejection = createDeferred<never>()
        const abortListener = () => abortRejection.reject(new Error("USER_CANCELLED"))
        runState.abortController.signal.addEventListener("abort", abortListener, { once: true })
        let result: { text: string; usage?: ProviderUsage; live?: LiveTurnSource }
        try {
          if (runState.abortController.signal.aborted) {
            abortListener()
          }
          result = await Promise.race([
            runStart.start(onChunk, onEntry, { keepAlive: args.keepAlive }),
            timeoutRejection.promise,
            maxTurnsRejection.promise,
            abortRejection.promise,
          ])
        } finally {
          runState.abortController.signal.removeEventListener("abort", abortListener)
        }
        finalText = result.text
        usage = result.usage
        liveHandle = result.live
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        let outcome: DelegationOutcome
        if (message === "TIMEOUT") {
          outcome = await this.failRun(args.chatId, runId, "TIMEOUT", `Run stalled (no activity for ${this.timeoutMs()}ms)`)
        } else if (message === "MAX_TURNS") {
          outcome = await this.failRun(args.chatId, runId, "MAX_TURNS", `Run exceeded maxTurns (${hostMaxTurns} tool calls)`)
        } else if (message === "USER_CANCELLED" || runState.cancelled) {
          outcome = await this.failRun(args.chatId, runId, "USER_CANCELLED", "Cancelled by user")
        } else {
          outcome = await this.failRun(args.chatId, runId, "PROVIDER_ERROR", message)
        }
        return outcome
      } finally {
        pausable.clear()
        runState.timeout = null
        if (chunkProgressTimer !== null) {
          clearTimeout(chunkProgressTimer)
          chunkProgressTimer = null
          this.deps.onRunProgress?.(args.chatId, runId)
        }
      }

      if (runState.cancelled) {
        return await this.failRun(args.chatId, runId, "USER_CANCELLED", "Cancelled by user")
      }

      await this.deps.store.appendSubagentEvent({
        v: 3,
        type: "subagent_run_completed",
        timestamp: this.now(),
        chatId: args.chatId,
        runId,
        finalContent: finalText,
        usage,
      })
      recordSubagentSpend(args.subagent.provider, usage)
      try {
        this.deps.onRunTerminal?.(args.chatId, runId, "completed")
      } catch (err) {
        log.warn(`${LOG_PREFIX} onRunTerminal(completed) threw`, { chatId: args.chatId, runId, err })
      }

      releaseSlot()

      const chainedMentions = parseMentions(finalText, this.deps.appSettings.getSnapshot().subagents)
      for (const mention of chainedMentions) {
        if (mention.kind !== "subagent") continue
        const chainSubagent = this.deps.appSettings.getSnapshot().subagents.find((s) => s.id === mention.subagentId)
        if (!chainSubagent) continue
        const childDepth = args.depth + 1
        if (childDepth > this.maxDepth()) {
          const childRunId = crypto.randomUUID()
          await this.deps.store.appendSubagentEvent({
            v: 3,
            type: "subagent_run_started",
            timestamp: this.now(),
            chatId: args.chatId,
            runId: childRunId,
            subagentId: chainSubagent.id,
            subagentName: chainSubagent.name,
            provider: chainSubagent.provider,
            model: chainSubagent.model,
            parentUserMessageId: args.parentUserMessageId,
            parentRunId: runId,
            depth: childDepth,
          })
          await this.failRun(args.chatId, childRunId, "DEPTH_EXCEEDED", `Chain depth ${childDepth} exceeds limit ${this.maxDepth()}`)
          continue
        }
        if ([...args.ancestorSubagentIds, args.subagent.id].includes(chainSubagent.id)) {
          const childRunId = crypto.randomUUID()
          await this.deps.store.appendSubagentEvent({
            v: 3,
            type: "subagent_run_started",
            timestamp: this.now(),
            chatId: args.chatId,
            runId: childRunId,
            subagentId: chainSubagent.id,
            subagentName: chainSubagent.name,
            provider: chainSubagent.provider,
            model: chainSubagent.model,
            parentUserMessageId: args.parentUserMessageId,
            parentRunId: runId,
            depth: childDepth,
          })
          await this.failRun(args.chatId, childRunId, "LOOP_DETECTED", `Subagent ${chainSubagent.name} already in ancestor chain`)
          continue
        }
        await this.spawnRun({
          subagent: chainSubagent,
          chatId: args.chatId,
          parentUserMessageId: args.parentUserMessageId,
          parentRunId: runId,
          depth: childDepth,
          ancestorSubagentIds: [...args.ancestorSubagentIds, args.subagent.id],
          userInstruction: finalText,
        })
      }
      if (args.keepAlive && liveHandle) {
        const session: LiveSession = {
          chatId: args.chatId,
          runId,
          subagentId: args.subagent.id,
          parentRunId: args.parentRunId,
          live: liveHandle,
          idleTimer: null,
          lastActivity: this.now(),
        }
        this.liveSessions.set(runId, session)
        this.armIdleTimer(runId)
        return { status: "completed", runId, text: finalText }
      }
      return { status: "completed", runId, text: finalText }
    } finally {
      releaseSlot()
      if (!this.liveSessions.has(runId)) this.cleanupRunState(runId)
    }
  }

  private armIdleTimer(runId: string): void {
    const s = this.liveSessions.get(runId)
    if (!s) return
    if (s.idleTimer) clearTimeout(s.idleTimer)
    s.idleTimer = setTimeout(() => { void this.closeLiveRun(s.chatId, runId, "idle_timeout") }, this.idleTimeoutMs())
  }

  async sendToLiveRun(runId: string, prompt: string): Promise<BackgroundRunOutcome> {
    const session = this.liveSessions.get(runId)
    if (!session) {
      return { status: "failed", runId, errorCode: "NO_LIVE_SESSION", errorMessage: `No live subagent session ${runId}` }
    }
    if (session.idleTimer) { clearTimeout(session.idleTimer); session.idleTimer = null }

    await this.acquire(session.chatId, runId)
    let released = false
    const releaseSlot = () => {
      if (released) return
      released = true
      this.release()
    }
    try {
      const { chatId } = session
      let chunkProgressTimer: ReturnType<typeof setTimeout> | null = null
      const CHUNK_PROGRESS_THROTTLE_MS = 100

      const onChunk = (chunk: string) => {
        if (!chunk) return
        this.deps.store
          .appendSubagentEvent({
            v: 3,
            type: "subagent_message_delta",
            timestamp: this.now(),
            chatId,
            runId,
            content: chunk,
          })
          .catch((err) => {
            log.warn(`${LOG_PREFIX} sendToLiveRun delta append failed`, { chatId, runId, err })
          })
        if (chunkProgressTimer !== null) clearTimeout(chunkProgressTimer)
        chunkProgressTimer = setTimeout(() => {
          chunkProgressTimer = null
          this.deps.onRunProgress?.(chatId, runId)
        }, CHUNK_PROGRESS_THROTTLE_MS)
      }

      const onEntry = (entry: TranscriptEntry) => {
        this.deps.store
          .appendSubagentEvent({
            v: 3,
            type: "subagent_entry_appended",
            timestamp: this.now(),
            chatId,
            runId,
            entry,
          })
          .catch((err) => {
            log.warn(`${LOG_PREFIX} sendToLiveRun entry append failed`, { chatId, runId, err })
          })
        this.deps.onRunProgress?.(chatId, runId)
      }

      let turn: { text: string; usage?: ProviderUsage }
      try {
        turn = await session.live.runTurn(prompt, onChunk, onEntry)
      } finally {
        if (chunkProgressTimer !== null) {
          clearTimeout(chunkProgressTimer)
          chunkProgressTimer = null
          this.deps.onRunProgress?.(session.chatId, runId)
        }
      }

      session.lastActivity = this.now()
      this.armIdleTimer(runId)
      return { status: "completed", runId, text: turn.text }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await this.closeLiveRun(session.chatId, runId, "error")
      return { status: "failed", runId, errorCode: "PROVIDER_ERROR", errorMessage: message }
    } finally {
      releaseSlot()
    }
  }

  async closeLiveRun(
    chatId: string,
    runId: string,
    reason: "explicit" | "idle_timeout" | "error" | "cancel",
  ): Promise<void> {
    const s = this.liveSessions.get(runId)
    if (!s) return
    this.liveSessions.delete(runId)
    if (s.idleTimer) { clearTimeout(s.idleTimer); s.idleTimer = null }
    try { await s.live.close() } catch (err) {
      log.warn(`${LOG_PREFIX} live close failed`, { chatId, runId, reason, err })
    }
    this.cleanupRunState(runId)
    try { this.deps.onRunTerminal?.(chatId, runId, "completed") } catch (err) {
      log.warn(`${LOG_PREFIX} onRunTerminal(completed) threw in closeLiveRun`, { chatId, runId, err })
    }
  }

  private cleanupRunState(runId: string) {
    const state = this.runStateByRunId.get(runId)
    if (!state) return
    state.timeout?.clear()
    if (state.parentRunId != null) {
      this.runStateByRunId.get(state.parentRunId)?.childRunIds.delete(runId)
    }
    this.runStateByRunId.delete(runId)
  }

  private async failRun(
    chatId: string,
    runId: string,
    code: SubagentErrorCode,
    message: string,
  ): Promise<DelegationOutcome> {
    log.warn(`${LOG_PREFIX} subagent run failed`, { chatId, runId, code, message })
    try {
      await this.deps.store.appendSubagentEvent({
        v: 3,
        type: "subagent_run_failed",
        timestamp: this.now(),
        chatId,
        runId,
        error: { code, message },
      })
    } catch (err) {
      log.warn(`${LOG_PREFIX} failRun appendSubagentEvent threw`, { chatId, runId, code, err })
    }
    try {
      this.deps.onRunTerminal?.(chatId, runId, "failed")
    } catch (err) {
      log.warn(`${LOG_PREFIX} onRunTerminal(failed) threw`, { chatId, runId, err })
    }
    return { status: "failed", runId, errorCode: code, errorMessage: message }
  }
}
