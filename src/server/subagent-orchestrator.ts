import {
  STORE_VERSION,
  type AgentProvider,
  type ProviderUsage,
  type Subagent,
  type SubagentErrorCode,
  type TranscriptEntry,
} from "../shared/types"
import crypto from "node:crypto"
import { LOG_PREFIX } from "../shared/branding"
import { log } from "../shared/log"
import { toError } from "../shared/errors"
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
import type { EventStore } from "./event-store"
import { buildHistoryPrimer, extractPreviousAssistantReply } from "./history-primer"
import { parseMentions, type ParsedMention } from "./mention-parser"
import { SUBAGENT_RUN_TIMEOUT_MS_DEFAULT } from "../shared/settings/bounds"

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

type RunStopReason = "timeout" | "max_turns" | "user_cancelled" | "chat_cancelled"

class RunStopped extends Error {
  constructor(readonly reason: RunStopReason) {
    super(reason)
    this.name = "RunStopped"
  }
}

function stopReasonOf(error: Error, cancelled: boolean): RunStopReason | null {
  if (error instanceof RunStopped) return error.reason
  return cancelled ? "user_cancelled" : null
}

function stopReasonToFailure(
  reason: RunStopReason,
  ctx: { started: boolean; timeoutMs: number; maxTurns: number | null },
): { code: SubagentErrorCode; message: string } {
  switch (reason) {
    case "timeout":
      return { code: "TIMEOUT", message: `Run stalled (no activity for ${ctx.timeoutMs}ms)` }
    case "max_turns":
      return { code: "MAX_TURNS", message: `Run exceeded maxTurns (${ctx.maxTurns} tool calls)` }
    case "user_cancelled":
      return {
        code: "USER_CANCELLED",
        message: ctx.started ? "Cancelled by user" : "Cancelled before run started",
      }
    case "chat_cancelled":
      return { code: "PROVIDER_ERROR", message: "Chat cancelled before run started" }
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

const DEFAULT_RUN_TIMEOUT_MS = SUBAGENT_RUN_TIMEOUT_MS_DEFAULT
const SUBAGENT_HISTORY_PRIMER_TAIL_LIMIT = 1000
const CHUNK_PROGRESS_THROTTLE_MS = 100

interface RefusalContext {
  chatId: string
  parentUserMessageId: string
  parentRunId: string | null
  depth: number
}

interface RefusedSubagent {
  subagentId: string | null
  name: string
  provider: AgentProvider
  model: string
}

function subagentIdentity(subagent: Subagent): RefusedSubagent {
  return { subagentId: subagent.id, name: subagent.name, provider: subagent.provider, model: subagent.model }
}

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
          v: STORE_VERSION,
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

  findSubagent(idOrName: string): Subagent | undefined {
    const subagents = this.deps.appSettings.getSnapshot().subagents
    const byId = subagents.find((s) => s.id === idOrName)
    if (byId) return byId
    const byName = subagents.filter((s) => s.name === idOrName)
    return byName.length === 1 ? byName[0] : undefined
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

  private admissionError(
    subagent: Subagent,
    depth: number,
    ancestorSubagentIds: readonly string[],
  ): { code: SubagentErrorCode; message: string } | null {
    if (depth > this.maxDepth()) {
      return { code: "DEPTH_EXCEEDED", message: `Chain depth ${depth} exceeds limit ${this.maxDepth()}` }
    }
    if (ancestorSubagentIds.includes(subagent.id)) {
      return { code: "LOOP_DETECTED", message: `Subagent ${subagent.name} already in ancestor chain` }
    }
    return null
  }

  private async refuseRun(
    ctx: RefusalContext,
    who: RefusedSubagent,
    code: SubagentErrorCode,
    message: string,
  ): Promise<DelegationOutcome> {
    const runId = crypto.randomUUID()
    await this.deps.store.appendSubagentEvent({
      v: STORE_VERSION,
      type: "subagent_run_started",
      timestamp: this.now(),
      chatId: ctx.chatId,
      runId,
      subagentId: who.subagentId,
      subagentName: who.name,
      provider: who.provider,
      model: who.model,
      parentUserMessageId: ctx.parentUserMessageId,
      parentRunId: ctx.parentRunId,
      depth: ctx.depth,
    })
    return await this.failRun(ctx.chatId, runId, code, message)
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
      throw new RunStopped("chat_cancelled")
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

  private async acquireSlot(chatId: string, runId: string): Promise<() => void> {
    await this.acquire(chatId, runId)
    let released = false
    return () => {
      if (released) return
      released = true
      this.release()
    }
  }

  private createRunSink(
    chatId: string,
    runId: string,
    hooks: {
      onActivity?: () => void
      beforeEntry?: (entry: TranscriptEntry) => void
      afterEntry?: (entry: TranscriptEntry) => void
    } = {},
  ): { onChunk: (chunk: string) => void; onEntry: (entry: TranscriptEntry) => void; flush: () => void } {
    let progressTimer: ReturnType<typeof setTimeout> | null = null
    return {
      onChunk: (chunk) => {
        if (!chunk) return
        hooks.onActivity?.()
        this.deps.store
          .appendSubagentEvent({
            v: STORE_VERSION,
            type: "subagent_message_delta",
            timestamp: this.now(),
            chatId,
            runId,
            content: chunk,
          })
          .catch((err) => {
            log.warn(`${LOG_PREFIX} subagent delta append failed`, { chatId, runId, err })
          })
        if (progressTimer !== null) clearTimeout(progressTimer)
        progressTimer = setTimeout(() => {
          progressTimer = null
          this.deps.onRunProgress?.(chatId, runId)
        }, CHUNK_PROGRESS_THROTTLE_MS)
      },
      onEntry: (entry) => {
        hooks.onActivity?.()
        hooks.beforeEntry?.(entry)
        this.deps.store
          .appendSubagentEvent({
            v: STORE_VERSION,
            type: "subagent_entry_appended",
            timestamp: this.now(),
            chatId,
            runId,
            entry,
          })
          .catch((err) => {
            log.warn(`${LOG_PREFIX} subagent entry append failed`, { chatId, runId, err })
          })
        this.deps.onRunProgress?.(chatId, runId)
        if (hooks.afterEntry) {
          try {
            hooks.afterEntry(entry)
          } catch (err) {
            log.warn(`${LOG_PREFIX} external onEntry threw`, { chatId, runId, err })
          }
        }
      },
      flush: () => {
        if (progressTimer === null) return
        clearTimeout(progressTimer)
        progressTimer = null
        this.deps.onRunProgress?.(chatId, runId)
      },
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
      w.reject(new RunStopped("chat_cancelled"))
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
      reject(new RunStopped("user_cancelled"))
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
    const refusalContext: RefusalContext = {
      chatId: args.chatId,
      parentUserMessageId: args.userMessageId,
      parentRunId: null,
      depth: 0,
    }

    for (const mention of args.mentions) {
      if (mention.kind === "unknown-subagent") {
        await this.refuseRun(
          refusalContext,
          { subagentId: null, name: mention.name, provider: "claude", model: "" },
          "UNKNOWN_SUBAGENT",
          `Unknown subagent '${mention.name}'`,
        )
        continue
      }
      const subagent = subagents.find((s) => s.id === mention.subagentId)
      if (!subagent) {
        await this.refuseRun(
          refusalContext,
          { subagentId: mention.subagentId, name: mention.subagentId, provider: "claude", model: "" },
          "UNKNOWN_SUBAGENT",
          `Subagent ${mention.subagentId} was deleted`,
        )
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
    const refusalContext: RefusalContext = {
      chatId: args.chatId,
      parentUserMessageId: args.parentUserMessageId,
      parentRunId: args.parentRunId,
      depth: args.depth,
    }
    const subagent = this.findSubagent(args.subagentId)
    if (!subagent) {
      return await this.refuseRun(
        refusalContext,
        { subagentId: args.subagentId, name: args.subagentId, provider: "claude", model: "" },
        "UNKNOWN_SUBAGENT",
        this.describeUnknownSubagent(args.subagentId),
      )
    }
    if (subagent.triggerMode === "manual" && !args.mentionedSubagentIds.includes(subagent.id)) {
      return await this.refuseRun(
        refusalContext,
        { subagentId: subagent.id, name: subagent.name, provider: "claude", model: "" },
        "MANUAL_ONLY",
        `Subagent ${subagent.name} is manual-trigger; the user must @-mention it to delegate`,
      )
    }
    const admission = this.admissionError(subagent, args.depth, args.ancestorSubagentIds)
    if (admission) {
      return await this.refuseRun(refusalContext, subagentIdentity(subagent), admission.code, admission.message)
    }
    if (args.keepAlive) {
      const liveForChat = [...this.liveSessions.values()].filter((s) => s.chatId === args.chatId).length
      if (liveForChat >= this.maxLive()) {
        return await this.refuseRun(
          refusalContext,
          subagentIdentity(subagent),
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
      v: STORE_VERSION,
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

    let releaseSlot: () => void
    try {
      releaseSlot = await this.acquireSlot(args.chatId, runId)
    } catch (err) {
      const reason = err instanceof RunStopped ? err.reason : "chat_cancelled"
      const { code, message } = stopReasonToFailure(reason, { started: false, timeoutMs: this.timeoutMs(), maxTurns: null })
      const outcome = await this.failRun(args.chatId, runId, code, message)
      this.cleanupRunState(runId)
      return outcome
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
        primer = buildHistoryPrimer(this.deps.store.getRecentRawEntries(args.chatId, SUBAGENT_HISTORY_PRIMER_TAIL_LIMIT), "")
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

      const hostMaxTurns = runStart.maxTurns !== undefined && runStart.maxTurns > 0 && !runStart.nativeMaxTurns
        ? runStart.maxTurns
        : null
      let toolCallCount = 0
      const maxTurnsRejection = createDeferred<never>()

      const sink = this.createRunSink(args.chatId, runId, {
        onActivity: () => runState.timeout?.reset(),
        beforeEntry: (entry) => {
          if (hostMaxTurns !== null && entry.kind === "tool_call") {
            toolCallCount += 1
            if (toolCallCount > hostMaxTurns) {
              maxTurnsRejection.reject(new RunStopped("max_turns"))
              runState.abortController.abort()
            }
          }
        },
        afterEntry: args.onEntry,
      })
      const timeoutRejection = createDeferred<never>()
      const pausable = new PausableTimeout(this.timeoutMs(), () => {
        timeoutRejection.reject(new RunStopped("timeout"))
        runState.abortController.abort()
      })
      runState.timeout = pausable
      pausable.start()
      try {
        const abortRejection = createDeferred<never>()
        const abortListener = () => abortRejection.reject(new RunStopped("user_cancelled"))
        runState.abortController.signal.addEventListener("abort", abortListener, { once: true })
        let result: { text: string; usage?: ProviderUsage; live?: LiveTurnSource }
        try {
          if (runState.abortController.signal.aborted) {
            abortListener()
          }
          result = await Promise.race([
            runStart.start(sink.onChunk, sink.onEntry, { keepAlive: args.keepAlive }),
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
      } catch (thrown) {
        const error = toError(thrown)
        const reason = stopReasonOf(error, runState.cancelled)
        if (reason === null) {
          return await this.failRun(args.chatId, runId, "PROVIDER_ERROR", error.message)
        }
        const { code, message } = stopReasonToFailure(reason, { started: true, timeoutMs: this.timeoutMs(), maxTurns: hostMaxTurns })
        return await this.failRun(args.chatId, runId, code, message)
      } finally {
        pausable.clear()
        runState.timeout = null
        sink.flush()
      }

      if (runState.cancelled) {
        return await this.failRun(args.chatId, runId, "USER_CANCELLED", "Cancelled by user")
      }

      await this.deps.store.appendSubagentEvent({
        v: STORE_VERSION,
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
        const admissionFailure = this.admissionError(
          chainSubagent,
          childDepth,
          [...args.ancestorSubagentIds, args.subagent.id],
        )
        if (admissionFailure) {
          await this.refuseRun(
            {
              chatId: args.chatId,
              parentUserMessageId: args.parentUserMessageId,
              parentRunId: runId,
              depth: childDepth,
            },
            subagentIdentity(chainSubagent),
            admissionFailure.code,
            admissionFailure.message,
          )
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

    const releaseSlot = await this.acquireSlot(session.chatId, runId)
    try {
      const { chatId } = session
      const sink = this.createRunSink(chatId, runId)

      let turn: { text: string; usage?: ProviderUsage }
      try {
        turn = await session.live.runTurn(prompt, sink.onChunk, sink.onEntry)
      } finally {
        sink.flush()
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
        v: STORE_VERSION,
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
