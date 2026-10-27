
import { log } from "../shared/log"
import { billedUsageOfResult } from "../shared/token-pricing"
import { toError } from "../shared/errors"
import type { AgentProvider, Subagent, TranscriptEntry } from "../shared/types"
import type { LimitDetector, LimitDetection } from "./auto-continue/limit-detector"
import type { AuthErrorDetection } from "./auto-continue/auth-error-detector"
import { backgroundTaskLaunchesFromToolResult, toolCallDescription } from "./claude-prompt-helpers"
import {
  classifyResultFailure,
  classifyThrownFailure,
  handledFailureLabel,
  handleDetectedFailure,
  type AuthErrorDetectable,
  type FailureDetectors,
} from "./claude-turn-failure"
import { recordTurnError } from "./claude-turn-outcome"
import { logClaudeSteer } from "./claude-steer-log"
import type { ClaudeSessionState, ActiveTurn } from "./claude-session-state"
import { isProactiveCompactTurn } from "./claude-session-state"
import type { PendingToolSlots } from "./pending-tool-slot"
import type { TurnEndGuard } from "./turn-end-guard"
import { createLiveBlockPublisher, type LiveBlockSink } from "./claude-live-publisher"

const RECENT_TOOL_DESCRIPTION_LIMIT = 64

const SELF_WAKE_ARMING_KINDS: ReadonlySet<TranscriptEntry["kind"]> = new Set([
  "assistant_text",
  "assistant_thinking",
  "tool_call",
  "tool_result",
])


interface RunClaudeSessionStore {
  appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
  recordTurnFailed(chatId: string, reason: string): Promise<void>
  setSessionTokenForProvider(chatId: string, provider: AgentProvider, token: string | null): Promise<void>
  setPendingForkSessionToken(
    chatId: string,
    token: { provider: AgentProvider; token: string } | null,
  ): Promise<void>
  recordTurnFinished(chatId: string): Promise<void>
  setCompactFailureCount(chatId: string, count: number): Promise<void>
  recordTurnCancelled(chatId: string): Promise<void>
  getChat(chatId: string): { compactFailureCount?: number; pendingForkSessionToken?: { token: string } | null } | null | undefined
}


interface OAuthPoolReleaseable {
  release(chatId: string): void
}


export interface RunClaudeSessionDeps {
  endpointFirstEntryTimeoutMs: number
  claudeSessions: Map<string, ClaudeSessionState>
  activeTurns: Map<string, ActiveTurn>
  pendingTools: PendingToolSlots
  oauthPool: OAuthPoolReleaseable | null
  claudeLimitDetector: LimitDetector
  claudeAuthErrorDetector: AuthErrorDetectable
  store: RunClaudeSessionStore
  emitStateChange(chatId?: string): void
  handleLimitDetection(chatId: string, detection: LimitDetection): Promise<boolean>
  maybeRegisterSdkWorkflowsDir(session: ClaudeSessionState): void
  getSubagents(): Subagent[]
  resolveBackgroundTaskMaxMs(): number
  handleAuthFailure(session: ClaudeSessionState, detection: AuthErrorDetection): Promise<boolean>
  closeClaudeSession(chatId: string, session: ClaudeSessionState): void
  maybeStartNextQueuedMessage(chatId: string): Promise<boolean | void>
  turnEndGuard?: TurnEndGuard
  onLiveBlock?: LiveBlockSink
  onBackgroundTaskLaunch?(chatId: string, taskId: string, outputPath: string | null): void
  onBackgroundTaskSettle?(chatId: string, taskId: string): void
}


function failureDetectors(deps: RunClaudeSessionDeps): FailureDetectors {
  return { limit: deps.claudeLimitDetector, auth: deps.claudeAuthErrorDetector }
}

async function discardInvalidSession(deps: RunClaudeSessionDeps, session: ClaudeSessionState): Promise<void> {
  deps.closeClaudeSession(session.chatId, session)
  await deps.store.setSessionTokenForProvider(session.chatId, "claude", null)
}

function firstEntryTimeoutMessage(session: ClaudeSessionState, timeoutMs: number): string {
  const label = session.endpointLabel ?? "The endpoint"
  return `${label} produced no response within ${timeoutMs}ms — the selected model may be invalid or the upstream stalled.`
}

export async function runClaudeSession(
  deps: RunClaudeSessionDeps,
  session: ClaudeSessionState,
): Promise<void> {
  const isEndpointSession = session.endpointModel !== null
  let turnAssistantText: string[] = []
  let firstEntrySeen = false
  let firstEntryWatchdog: ReturnType<typeof setTimeout> | null = null
  const clearFirstEntryWatchdog = () => {
    if (firstEntryWatchdog !== null) {
      clearTimeout(firstEntryWatchdog)
      firstEntryWatchdog = null
    }
  }
  const markStreamAlive = () => {
    firstEntrySeen = true
    clearFirstEntryWatchdog()
  }
  const livePublisher = createLiveBlockPublisher(
    session.chatId,
    () => deps.claudeSessions.get(session.chatId) === session,
    deps.onLiveBlock,
  )
  if (isEndpointSession) {
    firstEntryWatchdog = setTimeout(() => {
      if (firstEntrySeen) return
      if (deps.claudeSessions.get(session.chatId) !== session) return
      firstEntrySeen = true
      const message = firstEntryTimeoutMessage(session, deps.endpointFirstEntryTimeoutMs)
      log.warn("[kanna/agent] endpoint stream produced no entry within watchdog window — failing turn", {
        chatId: session.chatId,
        sessionId: session.id,
        endpoint: session.endpointKey,
        model: session.endpointModel,
        timeoutMs: deps.endpointFirstEntryTimeoutMs,
      })
      void (async () => {
        await recordTurnError(deps.store, session.chatId, message, deps.endpointFirstEntryTimeoutMs)
        const active = deps.activeTurns.get(session.chatId)
        if (active) deps.activeTurns.delete(session.chatId)
        deps.emitStateChange(session.chatId)
        void session.session.interrupt().catch(() => {})
        session.session.close()
      })()
    }, deps.endpointFirstEntryTimeoutMs)
  }
  try {
    loop: for await (const event of session.session.stream) {
      switch (event.type) {
        case "session_token": {
          session.sessionToken = event.sessionToken
          const isCurrentSession = deps.claudeSessions.get(session.chatId) === session
          if (isCurrentSession && session.persistsSessionToken()) {
            await deps.store.setSessionTokenForProvider(session.chatId, "claude", event.sessionToken)
          }
          deps.maybeRegisterSdkWorkflowsDir(session)
          deps.emitStateChange(session.chatId)
          continue
        }

        case "rate_limit": {
          if (deps.claudeSessions.get(session.chatId) !== session) continue
          await deps.handleLimitDetection(session.chatId, {
            chatId: session.chatId,
            resetAt: event.rateLimit.resetAt,
            tz: event.rateLimit.tz,
            raw: event,
          })
          if (deps.claudeSessions.get(session.chatId) !== session) break loop
          continue
        }

        case "live": {
          markStreamAlive()
          livePublisher.show(event.block)
          continue
        }

        case "transcript": {
          markStreamAlive()
          livePublisher.settle(event.entry.kind)
          if (deps.claudeSessions.get(session.chatId) !== session) break loop
      if (event.entry.kind === "result" && event.entry.isError && session.swallowCancelledErrorResult()) {
        continue
      }
      if (event.entry.kind === "system_init") {
        const kannaNames = deps.getSubagents().map((s) => s.name)
        if (kannaNames.length > 0) {
          const entry = event.entry
          const existing = new Set(entry.agents)
          const extra = kannaNames.filter((n) => !existing.has(n))
          if (extra.length > 0) {
            entry.agents = [...entry.agents, ...extra]
          }
        }
      }
      await deps.store.appendMessage(session.chatId, event.entry)
      session.lastUsedAt = Date.now()
      if (event.entry.kind === "assistant_text") {
        turnAssistantText.push(event.entry.text)
      }
      if (event.entry.kind === "tool_call") {
        const description = toolCallDescription(event.entry.tool)
        if (description) {
          session.recentToolDescriptions.set(event.entry.tool.toolId, description)
          while (session.recentToolDescriptions.size > RECENT_TOOL_DESCRIPTION_LIMIT) {
            const oldest = session.recentToolDescriptions.keys().next().value
            if (oldest === undefined) break
            session.recentToolDescriptions.delete(oldest)
          }
        }
        const tool = event.entry.tool
        if (
          (tool.toolKind === "bash" && tool.input.runInBackground === true) ||
          tool.toolKind === "subagent_task" ||
          tool.toolKind === "workflow"
        ) {
          session.backgroundLaunchToolIds.add(tool.toolId)
        }
      }
      if (!deps.activeTurns.has(session.chatId)) {
        if (event.entry.kind === "result") {
          if (session.selfWakeActive) {
            session.selfWakeActive = false
            deps.pendingTools.discard(session.chatId)
            deps.emitStateChange(session.chatId)
            await deps.maybeStartNextQueuedMessage(session.chatId)
          }
        } else if (SELF_WAKE_ARMING_KINDS.has(event.entry.kind) && !session.selfWakeActive) {
          if (session.canArmSelfWake()) {
            session.selfWakeActive = true
            deps.emitStateChange(session.chatId)
          }
        }
      }
      if (event.entry.kind === "tool_result") {
        const isLaunchResult = session.backgroundLaunchToolIds.has(event.entry.toolId)
        session.backgroundLaunchToolIds.delete(event.entry.toolId)
        if (isLaunchResult) {
          const launches = backgroundTaskLaunchesFromToolResult(event.entry.content)
          if (launches.length > 0) {
            const launchDescription = session.recentToolDescriptions.get(event.entry.toolId) ?? null
            const added = session.noteLaunch(launches, launchDescription, deps.resolveBackgroundTaskMaxMs(), Date.now())
            for (const { id, outputPath } of added) {
              deps.onBackgroundTaskLaunch?.(session.chatId, id, outputPath)
            }
            deps.emitStateChange(session.chatId)
          }
        }
      }
      if (event.entry.kind === "status" && event.entry.backgroundTaskIdsSnapshot) {
        session.applyLevelSnapshot(
          event.entry.backgroundTaskIdsSnapshot,
          event.entry.backgroundTasksSnapshot,
          deps.resolveBackgroundTaskMaxMs(),
          Date.now(),
        )
        deps.emitStateChange(session.chatId)
      } else if (event.entry.kind === "status" && event.entry.backgroundTaskId) {
        const settledId = event.entry.backgroundTaskId
        session.noteSettle(settledId, deps.resolveBackgroundTaskMaxMs(), Date.now())
        deps.onBackgroundTaskSettle?.(session.chatId, settledId)
        deps.emitStateChange(session.chatId)
      }
      const active = deps.activeTurns.get(session.chatId)
      if (event.entry.kind === "system_init" && active) {
        active.status = "running"
        const chat = deps.store.getChat(session.chatId)
        if (
          chat?.pendingForkSessionToken
          && session.sessionToken
          && session.sessionToken !== chat.pendingForkSessionToken.token
        ) {
          await deps.store.setPendingForkSessionToken(session.chatId, null)
        }
        logClaudeSteer("claude_event_system_init", {
          chatId: session.chatId,
          sessionId: session.id,
          activePromptSeq: active.claudePromptSeq ?? null,
          pendingPromptSeqs: [...session.pendingPromptSeqs],
        })
      }

      const completedClaudePromptSeq = event.entry.kind === "result" || event.entry.kind === "interrupted"
        ? session.completePrompt()
        : null
      if (completedClaudePromptSeq !== null) {
        session.lastUsedAt = Date.now()
      }

      logClaudeSteer("claude_event", {
        chatId: session.chatId,
        sessionId: session.id,
        entryKind: event.entry.kind,
        activePromptSeq: active?.claudePromptSeq ?? null,
        completedPromptSeq: completedClaudePromptSeq,
        activeStatus: active?.status ?? null,
        pendingPromptSeqs: [...session.pendingPromptSeqs],
      })

      if (
        event.entry.kind === "result"
        && active
        && active.claudePromptSeq != null
        && completedClaudePromptSeq === active.claudePromptSeq
      ) {
        active.hasFinalResult = true
        active.usage = billedUsageOfResult(event.entry)
        let failureHandled = false
        if (event.entry.isError) {
          const resultText = event.entry.result || "Turn failed"
          const failure = classifyResultFailure(
            failureDetectors(deps),
            session.chatId,
            resultText,
            event.entry.debugRaw ?? "",
          )
          failureHandled = await handleDetectedFailure(deps, session, failure)
          if (failureHandled) {
            await deps.store.recordTurnFailed(session.chatId, handledFailureLabel(failure))
          } else {
            await deps.store.recordTurnFailed(session.chatId, resultText)
            if (failure.sessionInvalid) await discardInvalidSession(deps, session)
          }
          if (isProactiveCompactTurn(active)) {
            const prev = deps.store.getChat(session.chatId)?.compactFailureCount ?? 0
            await deps.store.setCompactFailureCount(session.chatId, prev + 1)
          }
        } else if (!active.cancelRequested) {
          await deps.store.recordTurnFinished(session.chatId)
          if (isProactiveCompactTurn(active)) {
            await deps.store.setCompactFailureCount(session.chatId, 0)
          }
          await deps.turnEndGuard?.check(session.chatId, turnAssistantText)
        }
        deps.pendingTools.discard(session.chatId)
        deps.activeTurns.delete(session.chatId)
        if (!failureHandled) {
          deps.oauthPool?.release(session.chatId)
        }
        if (!active.cancelRequested) {
          await deps.maybeStartNextQueuedMessage(session.chatId)
        }
      } else if (event.entry.kind === "result" && event.entry.isError) {
        await handleDetectedFailure(
          deps,
          session,
          classifyResultFailure(
            failureDetectors(deps),
            session.chatId,
            event.entry.result || "",
            event.entry.debugRaw ?? "",
          ),
        )
      }

          if (event.entry.kind === "result") turnAssistantText = []

          deps.emitStateChange(session.chatId)
          break
        }

        default: {
          const _never: never = event
          void _never
        }
      }
    }
  } catch (caught) {
    const error = toError(caught)
    const active = deps.activeTurns.get(session.chatId)
    if (active && !active.cancelRequested) {
      const failure = classifyThrownFailure(failureDetectors(deps), session.chatId, error)
      if (await handleDetectedFailure(deps, session, failure)) {
        await deps.store.recordTurnFailed(session.chatId, handledFailureLabel(failure))
      } else {
        await recordTurnError(deps.store, session.chatId, error.message)
        if (failure.sessionInvalid) await discardInvalidSession(deps, session)
      }
    }
  } finally {
    clearFirstEntryWatchdog()
    livePublisher.clear()
    const active = deps.activeTurns.get(session.chatId)
    const resident = deps.claudeSessions.get(session.chatId)
    const isCurrentSession = resident === session
    const supersededBySession = resident !== undefined && !isCurrentSession
    const ownsActiveTurn = active !== undefined
      && (active.sessionId === undefined ? isCurrentSession : active.sessionId === session.id)
    log.info("[kanna/agent] runClaudeSession stream ended", {
      chatId: session.chatId,
      sessionId: session.id,
      sessionToken: session.sessionToken,
      isCurrentSession,
      hasActiveTurn: Boolean(active),
      activeStatus: active?.status,
      cancelRequested: active?.cancelRequested,
      hasFinalResult: active?.hasFinalResult,
    })
    if (isCurrentSession) {
      deps.claudeSessions.delete(session.chatId)
      deps.oauthPool?.release(session.chatId)
    }
    if (ownsActiveTurn && active.provider === "claude") {
      if (active.cancelRequested && !active.cancelRecorded) {
        await deps.store.recordTurnCancelled(session.chatId)
      } else if (!active.hasFinalResult) {
        log.warn("[kanna/agent] stream ended with no final result — recording turn failure", { chatId: session.chatId, sessionId: session.id })
        await deps.store.recordTurnFailed(session.chatId, "session stream ended without a result")
      }
      deps.activeTurns.delete(session.chatId)
    }
    if (!supersededBySession) {
      deps.pendingTools.discard(session.chatId)
    }
    session.selfWakeActive = false
    session.session.close()
    deps.emitStateChange(session.chatId)
  }
}
