
import { log } from "../shared/log"
import { billedUsageOfResult } from "../shared/token-pricing"
import { toError } from "../shared/errors"
import type { AgentProvider, Subagent, TranscriptEntry } from "../shared/types"
import type { LimitDetector, LimitDetection } from "./auto-continue/limit-detector"
import type { AuthErrorDetection } from "./auto-continue/auth-error-detector"
import type { ClaudeDriverPreference } from "../shared/types"
import {
  isPromptTooLongMessage,
  isNoConversationFoundMessage,
  backgroundTaskLaunchesFromToolResult,
  toolCallDescription,
} from "./claude-prompt-helpers"
import { timestamped } from "./claude-message-normalizer"
import { logClaudeSteer } from "./claude-steer-log"
import type { ClaudeSessionState, ActiveTurn } from "./claude-session-state"
import { isCliCompactTurn, isProactiveCompactTurn } from "./claude-session-state"
import type { PendingToolSlots } from "./pending-tool-slot"
import type { MermaidGuard } from "./mermaid-guard"

const RECENT_TOOL_DESCRIPTION_LIMIT = 64

const SELF_WAKE_ARMING_KINDS: ReadonlySet<TranscriptEntry["kind"]> = new Set([
  "assistant_text",
  "assistant_thinking",
  "tool_call",
  "tool_result",
])


interface AuthErrorDetectable {
  detect(chatId: string, error: Error): AuthErrorDetection | null
  detectFromResultText(chatId: string, text: string): AuthErrorDetection | null
}


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
  openrouterFirstEntryTimeoutMs: number
  claudeSessions: Map<string, ClaudeSessionState>
  activeTurns: Map<string, ActiveTurn>
  pendingTools: PendingToolSlots
  oauthPool: OAuthPoolReleaseable | null
  claudeLimitDetector: LimitDetector
  claudeAuthErrorDetector: AuthErrorDetectable
  throwOnClaudeSessionStart: boolean
  store: RunClaudeSessionStore
  emitStateChange(chatId?: string): void
  handleLimitDetection(chatId: string, detection: LimitDetection): Promise<boolean>
  maybeRegisterSdkWorkflowsDir(session: ClaudeSessionState): void
  getSubagents(): Subagent[]
  resolveBackgroundTaskMaxMs(): number
  handleLimitError(chatId: string, detector: LimitDetector, error: Error): Promise<boolean>
  handleAuthFailure(session: ClaudeSessionState, detection: AuthErrorDetection): Promise<boolean>
  closeClaudeSession(chatId: string, session: ClaudeSessionState): void
  maybeStartNextQueuedMessage(chatId: string): Promise<boolean | void>
  resolveClaudeDriverPreference(): ClaudeDriverPreference
  mermaidGuard?: MermaidGuard
  onBackgroundTaskLaunch?(chatId: string, taskId: string, outputPath: string | null): void
  onBackgroundTaskSettle?(chatId: string, taskId: string): void
}


export async function runClaudeSession(
  deps: RunClaudeSessionDeps,
  session: ClaudeSessionState,
): Promise<void> {
  const isOpenRouterSession = session.openrouterModel !== null
  let turnAssistantText: string[] = []
  let firstEntrySeen = false
  let firstEntryWatchdog: ReturnType<typeof setTimeout> | null = null
  const clearFirstEntryWatchdog = () => {
    if (firstEntryWatchdog !== null) {
      clearTimeout(firstEntryWatchdog)
      firstEntryWatchdog = null
    }
  }
  if (isOpenRouterSession) {
    firstEntryWatchdog = setTimeout(() => {
      if (firstEntrySeen) return
      if (deps.claudeSessions.get(session.chatId) !== session) return
      firstEntrySeen = true
      const message = `OpenRouter produced no response within ${deps.openrouterFirstEntryTimeoutMs}ms — the selected model may be invalid or the upstream stalled.`
      log.warn("[kanna/agent] openrouter stream produced no entry within watchdog window — failing turn", {
        chatId: session.chatId,
        sessionId: session.id,
        model: session.openrouterModel,
        timeoutMs: deps.openrouterFirstEntryTimeoutMs,
      })
      void (async () => {
        await deps.store.appendMessage(
          session.chatId,
          timestamped({
            kind: "result",
            subtype: "error",
            isError: true,
            durationMs: deps.openrouterFirstEntryTimeoutMs,
            result: message,
          }),
        )
        await deps.store.recordTurnFailed(session.chatId, message)
        const active = deps.activeTurns.get(session.chatId)
        if (active) deps.activeTurns.delete(session.chatId)
        deps.emitStateChange(session.chatId)
        void session.session.interrupt().catch(() => {})
        session.session.close()
      })()
    }, deps.openrouterFirstEntryTimeoutMs)
  }
  try {
    let simulateLimit = deps.throwOnClaudeSessionStart
    loop: for await (const event of session.session.stream) {
      if (simulateLimit) {
        simulateLimit = false
        throw new Error("simulated rate limit")
      }
      switch (event.type) {
        case "session_token": {
          session.sessionToken = event.sessionToken
          const isCurrentSession = deps.claudeSessions.get(session.chatId) === session
          if (
            isCurrentSession
            && session.cancelledResultPending === 0
            && !session.suppressSessionTokenPersist
          ) {
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

        case "transcript": {
          firstEntrySeen = true
          clearFirstEntryWatchdog()
          if (deps.claudeSessions.get(session.chatId) !== session) break loop
      if (
        event.entry.kind === "result" &&
        event.entry.isError &&
        session.cancelledResultPending > 0
      ) {
        session.cancelledResultPending -= 1
        session.selfWakeActive = false
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
          if (!session.backgroundTaskWakeSuppressed && session.cancelledResultPending === 0) {
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
        ? (session.pendingPromptSeqs.shift() ?? null)
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
        event.entry.kind === "compact_boundary"
        && active !== undefined
        && isCliCompactTurn(active)
        && !active.cancelRequested
        && deps.resolveClaudeDriverPreference() === "pty"
      ) {
        active.hasFinalResult = true
        await deps.store.recordTurnFinished(session.chatId)
        if (isProactiveCompactTurn(active)) {
          await deps.store.setCompactFailureCount(session.chatId, 0)
        }
        if (active.claudePromptSeq != null) {
          const idx = session.pendingPromptSeqs.indexOf(active.claudePromptSeq)
          if (idx >= 0) session.pendingPromptSeqs.splice(idx, 1)
        }
        deps.activeTurns.delete(session.chatId)
        deps.oauthPool?.release(session.chatId)
        await deps.maybeStartNextQueuedMessage(session.chatId)
        deps.emitStateChange(session.chatId)
        continue
      }

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
          const debugRaw = event.entry.debugRaw ?? ""
          const detection = deps.claudeLimitDetector.detectFromResultText?.(session.chatId, resultText) ?? null
          const authDetection = deps.claudeAuthErrorDetector.detectFromResultText(session.chatId, resultText)
            ?? deps.claudeAuthErrorDetector.detectFromResultText(session.chatId, debugRaw)
          let handled = false
          if (detection) {
            handled = await deps.handleLimitDetection(session.chatId, detection)
          } else if (authDetection) {
            handled = await deps.handleAuthFailure(session, authDetection)
          }
          failureHandled = handled
          if (handled) {
            await deps.store.recordTurnFailed(session.chatId, detection ? "rate_limit" : "auth_error")
          } else if (
            isPromptTooLongMessage(resultText)
            || isNoConversationFoundMessage(resultText)
            || isNoConversationFoundMessage(debugRaw)
          ) {
            await deps.store.recordTurnFailed(session.chatId, resultText)
            deps.closeClaudeSession(session.chatId, session)
            await deps.store.setSessionTokenForProvider(session.chatId, "claude", null)
          } else {
            await deps.store.recordTurnFailed(session.chatId, resultText)
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
          await deps.mermaidGuard?.check(session.chatId, turnAssistantText)
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
        const resultText = event.entry.result || ""
        const debugRaw = event.entry.debugRaw ?? ""
        const detection = deps.claudeLimitDetector.detectFromResultText?.(session.chatId, resultText) ?? null
        const authDetection = detection
          ? null
          : deps.claudeAuthErrorDetector.detectFromResultText(session.chatId, resultText)
            ?? deps.claudeAuthErrorDetector.detectFromResultText(session.chatId, debugRaw)
        if (detection) {
          await deps.handleLimitDetection(session.chatId, detection)
        } else if (authDetection) {
          await deps.handleAuthFailure(session, authDetection)
        }
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
      const limitHandled = await deps.handleLimitError(session.chatId, deps.claudeLimitDetector, error)
      const authDetection = limitHandled
        ? null
        : deps.claudeAuthErrorDetector.detect(session.chatId, error)
      const authHandled = authDetection
        ? await deps.handleAuthFailure(session, authDetection)
        : false
      const handled = limitHandled || authHandled
      if (!handled) {
        const message = error.message
        await deps.store.appendMessage(
          session.chatId,
          timestamped({
            kind: "result",
            subtype: "error",
            isError: true,
            durationMs: 0,
            result: message,
          })
        )
        await deps.store.recordTurnFailed(session.chatId, message)
        if (isPromptTooLongMessage(message) || isNoConversationFoundMessage(message)) {
          deps.closeClaudeSession(session.chatId, session)
          await deps.store.setSessionTokenForProvider(session.chatId, "claude", null)
        }
      } else {
        await deps.store.recordTurnFailed(session.chatId, limitHandled ? "rate_limit" : "auth_error")
      }
    }
  } finally {
    clearFirstEntryWatchdog()
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
