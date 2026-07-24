/**
 * Standalone event-loop runner for an active Claude session.
 *
 * Extracted from AgentCoordinator.runClaudeSession in agent.ts so the ~414-line
 * method can live in its own testable module. The coordinator delegates to this
 * function by passing an object literal that satisfies `RunClaudeSessionDeps`.
 *
 * Side-effect seal: this file is pure logic — no direct IO. Any IO is injected
 * through the deps interface.
 */

import { log } from "../shared/log"
import type { AnyValue } from "../shared/errors"
import type { AgentProvider, Subagent, TranscriptEntry } from "../shared/types"
import type { LimitDetector, LimitDetection } from "./auto-continue/limit-detector"
import type { AuthErrorDetection } from "./auto-continue/auth-error-detector"
import type { ClaudeDriverPreference } from "../shared/types"
import {
  isPromptTooLongMessage,
  isNoConversationFoundMessage,
  backgroundTaskIdsFromToolResult,
} from "./claude-prompt-helpers"
import { timestamped } from "./claude-message-normalizer"
import { logClaudeSteer } from "./claude-steer-log"
import type { ClaudeSessionState, ActiveTurn, SlashCommand } from "./claude-session-state"

// ---------------------------------------------------------------------------
// Structural auth-error detector — only the methods called in this module.
// Using a structural interface instead of the concrete ClaudeAuthErrorDetector
// class keeps test deps minimal without requiring `as unknown as`.
// ---------------------------------------------------------------------------

interface AuthErrorDetectable {
  detect(chatId: string, error: AnyValue): AuthErrorDetection | null
  detectFromResultText(chatId: string, text: string): AuthErrorDetection | null
}

// ---------------------------------------------------------------------------
// Minimal store interface — only the methods runClaudeSession actually calls.
// ---------------------------------------------------------------------------

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
  recordSessionCommandsLoaded(chatId: string, commands: SlashCommand[]): Promise<void>
}

// ---------------------------------------------------------------------------
// Minimal oauth-pool interface — only the release() call used in this module.
// ---------------------------------------------------------------------------

interface OAuthPoolReleaseable {
  release(chatId: string): void
}

// ---------------------------------------------------------------------------
// Dependency bundle injected by AgentCoordinator
// ---------------------------------------------------------------------------

export interface RunClaudeSessionDeps {
  openrouterFirstEntryTimeoutMs: number
  claudeSessions: Map<string, ClaudeSessionState>
  activeTurns: Map<string, ActiveTurn>
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
  handleLimitError(chatId: string, detector: LimitDetector, error: AnyValue): Promise<boolean>
  handleAuthFailure(session: ClaudeSessionState, detection: AuthErrorDetection): Promise<boolean>
  closeClaudeSession(chatId: string, session: ClaudeSessionState): void
  maybeStartNextQueuedMessage(chatId: string): Promise<boolean | void>
  resolveClaudeDriverPreference(): ClaudeDriverPreference
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Consumes the HarnessEvent stream for a running Claude session and handles:
 * - session_token persistence and workflow-dir registration
 * - rate-limit / auth-failure detection and delegation
 * - transcript entry appending and active-turn bookkeeping
 * - background-task keep-alive tracking
 * - compact-boundary finalization (PTY driver only)
 * - fail-close on stream end without a terminal result
 *
 * Behavior is identical to the original private method on AgentCoordinator.
 */
export async function runClaudeSession(
  deps: RunClaudeSessionDeps,
  session: ClaudeSessionState,
): Promise<void> {
  // OpenRouter-only first-entry watchdog. OpenRouter routes through the
  // Claude SDK; a stalled upstream emits the session-token handshake then
  // goes silent — the stream stays open with no entry, so this for-await
  // never returns or throws and the chat hangs "running" until restart. The
  // existing catch/finally fail-close is claude-provider-gated and depends
  // on an active turn that the openrouter path tears down early, so the
  // watchdog records the failure itself, then interrupts + closes the
  // session to end the stream. `firstEntrySeen` guards against a late real
  // entry; close() prevents any further entry from being processed.
  const isOpenRouterSession = session.openrouterModel !== null
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
    for await (const event of session.session.stream) {
      if (simulateLimit) {
        simulateLimit = false
        throw new Error("simulated rate limit")
      }
      if (event.type === "session_token" && event.sessionToken) {
        session.sessionToken = event.sessionToken
        // Persist only when this session is still current, no cancel is in
        // flight, and no /clear suppressed it. A cancelled spawn can emit
        // its session_token AFTER the user interrupted — the CLI may never
        // persist that conversation, so storing the token would poison the
        // next `--resume` ("No conversation found with session ID"). A
        // /clear (setup_loop, background delivery) mid-stream must likewise
        // not be resurrected by the old conversation's next token event.
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

      if (event.type === "rate_limit" && event.rateLimit) {
        // Stale rate_limit events from a session that has already been
        // rotated away must not trigger another rotation/continue.
        if (deps.claudeSessions.get(session.chatId) !== session) continue
        await deps.handleLimitDetection(session.chatId, {
          chatId: session.chatId,
          resetAt: event.rateLimit.resetAt,
          tz: event.rateLimit.tz,
          raw: event,
        })
        if (deps.claudeSessions.get(session.chatId) !== session) break
        continue
      }

      if (!event.entry) continue
      firstEntrySeen = true
      clearFirstEntryWatchdog()
      if (deps.claudeSessions.get(session.chatId) !== session) break
      // Suppress the interrupt-induced tail `result` of a cancelled turn.
      // cancel() already removed the active turn, recorded the cancellation,
      // and appended the `interrupted` entry; the SDK then emits one error
      // `result` (subtype error_during_execution, empty text) that would
      // otherwise render as "An unknown error occurred." Drop it (and skip
      // the seq shift — cancel() already spliced the cancelled seq).
      if (
        event.entry.kind === "result" &&
        event.entry.isError &&
        session.cancelledResultPending > 0
      ) {
        session.cancelledResultPending -= 1
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
      // Stream activity keeps the session warm. Task-notification self-wakes
      // stream entries without a Kanna-driven turn (no activeTurn, no
      // lastUsedAt bump at turn start), so without this the idle reaper's
      // clock runs from the last real turn and kills the session mid-work —
      // mirrors claude-code's own invariant that the idle timer starts only
      // after the run loop exits.
      session.lastUsedAt = Date.now()
      // Background-task keep-alive guard (SDK + PTY).
      // On launch: add the task id and refresh the zombie-backstop deadline.
      // On settle (task_notification): remove the id — gate primary signal is
      // set size>0, not the clock. The deadline (default 4h) is refreshed on
      // every launch and settle so it only fires when a notification is truly
      // lost (SDK crash / dropped message), never during normal execution.
      // A `backgroundTaskIdsSnapshot` status entry (SDK background_tasks_changed
      // level signal) REPLACES the whole set — authoritative over both edges.
      if (event.entry.kind === "tool_result") {
        const launchedIds = backgroundTaskIdsFromToolResult(
          event.entry.content,
        )
        if (launchedIds.length > 0) {
          for (const id of launchedIds) session.backgroundTaskIds.add(id)
          session.backgroundTaskDeadlineAt = Date.now() + deps.resolveBackgroundTaskMaxMs()
          deps.emitStateChange(session.chatId)
        }
      }
      if (event.entry.kind === "status" && event.entry.backgroundTaskIdsSnapshot) {
        session.backgroundTaskIds = new Set(event.entry.backgroundTaskIdsSnapshot)
        session.backgroundTaskDeadlineAt = session.backgroundTaskIds.size > 0
          ? Date.now() + deps.resolveBackgroundTaskMaxMs()
          : 0
        deps.emitStateChange(session.chatId)
      } else if (event.entry.kind === "status" && event.entry.backgroundTaskId) {
        const settledId = event.entry.backgroundTaskId
        session.backgroundTaskIds.delete(settledId)
        if (session.backgroundTaskIds.size > 0) {
          session.backgroundTaskDeadlineAt = Date.now() + deps.resolveBackgroundTaskMaxMs()
        } else {
          session.backgroundTaskDeadlineAt = 0
        }
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
        // NOTE: the chat's slashCommands are populated exclusively from the
        // local disk catalog on chat-open (`ensureSlashCommandsLoaded`); the
        // CLI `system_init` command list is intentionally NOT merged in here,
        // so the picker never surfaces built-in / plugin CLI commands.
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

      // PTY-only: the Kanna-injected proactive `/compact` turn never emits a
      // terminal `result`/`turn_duration` under the interactive TUI — it
      // writes only a `system/compact_boundary` line (confirmed in the
      // on-disk transcript). Without a result, the normal finalize path below
      // (kind === "result") never runs, so the active turn and its
      // `proactiveCompactInjection` flag linger forever — permanently wedging
      // `dequeue()` ("Cannot remove queued message while compact is running")
      // and the queued-message drain. Treat the boundary as the compact
      // turn's completion: finalize like the SDK result path and drain the
      // queued user message the compact made room for. The SDK driver is
      // excluded because there a real `result` still follows; finalizing here
      // would double-finalize and corrupt the trailing result's seq
      // accounting. See adr-20260608-pty-compact-boundary-dequeue-finalize.
      if (
        event.entry.kind === "compact_boundary"
        && active?.proactiveCompactInjection
        && !active.cancelRequested
        && deps.resolveClaudeDriverPreference() === "pty"
      ) {
        active.hasFinalResult = true
        await deps.store.recordTurnFinished(session.chatId)
        await deps.store.setCompactFailureCount(session.chatId, 0)
        // The compact prompt's seq never gets shifted (no result event), so
        // drop it here — otherwise the next real turn's result would shift
        // this stale seq and FIFO-mismatch, wedging that turn. Mirrors
        // cancel()'s pending-seq drain.
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

      if (event.entry.kind === "result" && active && completedClaudePromptSeq === (active.claudePromptSeq ?? null)) {
        active.hasFinalResult = true
        // True once a rate-limit / auth-error was routed through
        // handleLimitDetection / handleAuthFailure. Those paths already
        // marked the failed token limited/errored (dropping its
        // reservation) and, when a rotation target exists, pinned the
        // replacement token under this chatId for the scheduled
        // auto-continue to reuse. The turn-scoped release below MUST be
        // skipped in that case — otherwise it drops the freshly-pinned
        // rotation token and a concurrent chat can steal it before
        // fireAutoContinue spawns the replacement session (audit #1).
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
          if (active.proactiveCompactInjection) {
            const prev = deps.store.getChat(session.chatId)?.compactFailureCount ?? 0
            await deps.store.setCompactFailureCount(session.chatId, prev + 1)
          }
        } else if (!active.cancelRequested) {
          await deps.store.recordTurnFinished(session.chatId)
          if (active.proactiveCompactInjection) {
            await deps.store.setCompactFailureCount(session.chatId, 0)
          }
          // Note: pending-workflow harvest wake removed — workflow-completion
          // notification is a follow-up ADR. Model can delegate a status-check
          // subagent if it needs event-driven workflow wake.
        }
        deps.activeTurns.delete(session.chatId)
        // Turn-scoped reservation: release on turn end so other chats can
        // claim the same token while this chat is idle. The next turn for
        // this chat reuses the same claude session (no re-pick); the
        // rotation race between in-flight turns is still serialized via
        // markLimited/markError (both drop the reservation) and the
        // atomic single-threaded pickActive(chatId) calls.
        //
        // Skip when a rotation handled the failure: the rotation already
        // pinned the replacement token under this chatId and the
        // scheduled auto-continue (TOKEN_ROTATION_SCHEDULE_DELAY_MS later)
        // depends on that pin still being held.
        if (!failureHandled) {
          deps.oauthPool?.release(session.chatId)
        }
        if (!active.cancelRequested) {
          await deps.maybeStartNextQueuedMessage(session.chatId)
        }
      } else if (event.entry.kind === "result" && event.entry.isError) {
        // Fallback: an errored result carrying a recognizable rate-limit /
        // auth signature must NOT be silently dropped just because its
        // prompt-seq did not line up with the active turn. Observed as a 9h
        // autonomous-loop stall: a synthetic 429 result on an auto-continue
        // wake turn arrived with the pending prompt-seq queue already drained
        // (so the seq gate above missed), and the loop died with no resume
        // schedule — no proposal, no accept — until a human manually resumed.
        // handleLimitDetection is idempotent (dedupes on a live schedule) and
        // handleAuthFailure only rotates/proposes, so re-driving detection
        // here only ever adds a missing resume, never a duplicate. The
        // auto-resume setting is still honoured inside handleLimitDetection.
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

      deps.emitStateChange(session.chatId)
    }
  } catch (error) {
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
        const message = error instanceof Error ? error.message : String(error)
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
    const isCurrentSession = deps.claudeSessions.get(session.chatId) === session
    // Trace point: stream-end-without-final-result is the hang signature.
    // If `hasActiveTurn=true` && `hasFinalResult=false` && this fires,
    // the user will see "still running" forever unless we fail-close.
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
    // Only clear chat state if it still points at us. A cancel-then-steer,
    // or an oauth-pool rotation that closes this session and schedules an
    // auto-continue, can install a fresh session (and activeTurn) under
    // the same chatId before this finally runs; wiping either
    // unconditionally would break the fresh session's bookkeeping and
    // leave its stream running headless (no isError branch fires →
    // sessionToken never cleared → next turn loops with the same
    // too-large --resume context).
    if (isCurrentSession) {
      deps.claudeSessions.delete(session.chatId)
      deps.oauthPool?.release(session.chatId)
      if (active?.provider === "claude") {
        if (active.cancelRequested && !active.cancelRecorded) {
          await deps.store.recordTurnCancelled(session.chatId)
        } else if (!active.hasFinalResult) {
          // Stream ended without any terminal result event (PTY died,
          // SDK transport dropped, etc). Fail-close the turn so the UI
          // stops showing "running" forever. Without this the chat is
          // wedged until the user manually clicks Stop or reloads.
          log.warn("[kanna/agent] stream ended with no final result — recording turn failure", { chatId: session.chatId, sessionId: session.id })
          await deps.store.recordTurnFailed(session.chatId, "session stream ended without a result")
        }
        deps.activeTurns.delete(session.chatId)
      }
    }
    session.session.close()
    deps.emitStateChange(session.chatId)
  }
}
