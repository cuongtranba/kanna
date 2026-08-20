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
  backgroundTaskLaunchesFromToolResult,
  mergeBackgroundTaskSnapshot,
  toolCallDescription,
} from "./claude-prompt-helpers"
import { timestamped } from "./claude-message-normalizer"
import { logClaudeSteer } from "./claude-steer-log"
import type { ClaudeSessionState, ActiveTurn } from "./claude-session-state"
import { isCliCompactTurn, isProactiveCompactTurn } from "./claude-session-state"
import type { PendingToolSlots } from "./pending-tool-slot"
import type { MermaidGuard } from "./mermaid-guard"

// Bounded FIFO for toolId → description lookups feeding background-task labels.
const RECENT_TOOL_DESCRIPTION_LIMIT = 64

// Entry kinds that prove the model is actively producing a self-wake turn.
// `status` / `context_window_updated` / housekeeping kinds intentionally do
// NOT arm — a lone level snapshot must never wedge the chat in "running".
const SELF_WAKE_ARMING_KINDS: ReadonlySet<TranscriptEntry["kind"]> = new Set([
  "assistant_text",
  "assistant_thinking",
  "tool_call",
  "tool_result",
])

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
  handleLimitError(chatId: string, detector: LimitDetector, error: AnyValue): Promise<boolean>
  handleAuthFailure(session: ClaudeSessionState, detection: AuthErrorDetection): Promise<boolean>
  closeClaudeSession(chatId: string, session: ClaudeSessionState): void
  maybeStartNextQueuedMessage(chatId: string): Promise<boolean | void>
  resolveClaudeDriverPreference(): ClaudeDriverPreference
  /**
   * Validates the mermaid the model just wrote and asks it to fix anything
   * that will not render. Omit to disable the backstop.
   */
  mermaidGuard?: MermaidGuard
  onBackgroundTaskLaunch?(chatId: string, taskId: string, outputPath: string | null): void
  onBackgroundTaskSettle?(chatId: string, taskId: string): void
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
  // Assistant text of the turn in flight, for the end-of-turn mermaid guard.
  // The server sees no deltas — each `assistant_text` entry is a complete
  // content block — but a turn emits several, interleaved with tool rounds.
  // Cleared on EVERY terminal result, so a self-wake turn's text is dropped
  // rather than attributed to the next real turn.
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
      if (event.entry.kind === "assistant_text") {
        turnAssistantText.push(event.entry.text)
      }
      // Remember recent tool_call descriptions so a background launch seen
      // only through the tool_result regex (PTY driver; SDK version skew)
      // can label the task in the UI with the launching call's description.
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
      }
      // Task-notification self-wake turns stream entries with NO ActiveTurn
      // (they never pass through Kanna's turn machinery, so no turn_started/
      // turn_finished events exist). Track that live window on the session so
      // getActiveStatuses surfaces the chat as "running" (spinner + Stop in
      // the composer) while the model actually works. Armed by model-activity
      // entries, disarmed by the wake turn's terminal `result`. Self-healing:
      // the flag dies with the session (idle reaper still keys on lastUsedAt).
      if (!deps.activeTurns.has(session.chatId)) {
        if (event.entry.kind === "result") {
          if (session.selfWakeActive) {
            session.selfWakeActive = false
            // The wake turn is over: settle any request it parked (a blocked
            // canUseTool normally prevents a result, so this is defensive)
            // and hand the chat to the next queued message — the send gate
            // queues user messages while a self-wake streams, and this
            // terminal result is the only signal that frees them.
            deps.pendingTools.discard(session.chatId)
            deps.emitStateChange(session.chatId)
            await deps.maybeStartNextQueuedMessage(session.chatId)
          }
        } else if (SELF_WAKE_ARMING_KINDS.has(event.entry.kind) && !session.selfWakeActive) {
          session.selfWakeActive = true
          deps.emitStateChange(session.chatId)
        }
      }
      // Background-task keep-alive guard (SDK + PTY).
      // On launch: add the task id and refresh the zombie-backstop deadline.
      // On settle (task_notification): remove the id — gate primary signal is
      // set size>0, not the clock. The deadline (default 30 min,
      // DEFAULT_PTY_BACKGROUND_TASK_MAX_MS) is refreshed on every launch and
      // settle, and applies ONLY to a session that has never seen a level
      // snapshot (PTY / old CLI) — see backgroundTasksLevelSourced.
      // A `backgroundTaskIdsSnapshot` status entry (SDK background_tasks_changed
      // level signal) REPLACES the whole set — authoritative over both edges.
      if (event.entry.kind === "tool_result") {
        const launches = backgroundTaskLaunchesFromToolResult(event.entry.content)
        if (launches.length > 0) {
          // empty→non-empty = a fresh watch epoch: restore the watchdog
          // wake budget (adr-20260801-background-task-wake-escalation).
          if (session.backgroundTasks.size === 0) session.backgroundTaskWakeCount = 0
          const launchDescription = session.recentToolDescriptions.get(event.entry.toolId) ?? null
          for (const { id, outputPath } of launches) {
            if (!session.backgroundTasks.has(id)) {
              session.backgroundTasks.set(id, {
                taskType: null,
                description: launchDescription,
                startedAt: Date.now(),
                outputPath,
              })
              deps.onBackgroundTaskLaunch?.(session.chatId, id, outputPath)
            }
          }
          session.backgroundTaskDeadlineAt = Date.now() + deps.resolveBackgroundTaskMaxMs()
          deps.emitStateChange(session.chatId)
        }
      }
      if (event.entry.kind === "status" && event.entry.backgroundTaskIdsSnapshot) {
        // The SDK level signal exists on this session, so from here on set
        // membership is authoritative and the deadline is no longer consulted
        // (adr-20260808-background-task-level-signal-authoritative). Sticky:
        // an EMPTY snapshot proves the signal works just as well as a
        // non-empty one, so this is never reset — only a respawn clears it,
        // which is exactly the SDK's per-process rule.
        session.backgroundTasksLevelSourced = true
        const wasEmpty = session.backgroundTasks.size === 0
        session.backgroundTasks = mergeBackgroundTaskSnapshot(
          session.backgroundTasks,
          event.entry.backgroundTaskIdsSnapshot,
          event.entry.backgroundTasksSnapshot,
          Date.now(),
        )
        if (wasEmpty && session.backgroundTasks.size > 0) session.backgroundTaskWakeCount = 0
        session.backgroundTaskDeadlineAt = session.backgroundTasks.size > 0
          ? Date.now() + deps.resolveBackgroundTaskMaxMs()
          : 0
        deps.emitStateChange(session.chatId)
      } else if (event.entry.kind === "status" && event.entry.backgroundTaskId) {
        const settledId = event.entry.backgroundTaskId
        session.backgroundTasks.delete(settledId)
        deps.onBackgroundTaskSettle?.(session.chatId, settledId)
        if (session.backgroundTasks.size > 0) {
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
        // NOTE: the composer picker is served by the project-scoped
        // `project-commands` topic, straight off the local disk catalog. The
        // CLI `system_init` command list is intentionally NOT merged in here.
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

      // PTY-only: a `/compact` turn never emits a terminal
      // `result`/`turn_duration` under the interactive TUI — it writes only a
      // `system/compact_boundary` line (confirmed in the on-disk transcript).
      // Without a result, the normal finalize path below (kind === "result")
      // never runs, so the active turn lingers forever — permanently wedging
      // `dequeue()` ("Cannot remove queued message while compact is running")
      // and the queued-message drain. Treat the boundary as the compact
      // turn's completion: finalize like the SDK result path and drain the
      // queued user message the compact made room for. Applies to a
      // user-typed `/compact` as well as Kanna's own injection — both reach
      // the CLI verbatim, so both go quiet the same way. The SDK driver is
      // excluded because there a real `result` still follows; finalizing here
      // would double-finalize and corrupt the trailing result's seq
      // accounting. See adr-20260608-pty-compact-boundary-dequeue-finalize.
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

      if (
        event.entry.kind === "result"
        && active
        // No prompt, no finalize: a result can only complete a turn that
        // actually sent one. The null-check guards any seq-less producer
        // from matching a null completed seq.
        && active.claudePromptSeq != null
        && completedClaudePromptSeq === active.claudePromptSeq
      ) {
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
          if (isProactiveCompactTurn(active)) {
            const prev = deps.store.getChat(session.chatId)?.compactFailureCount ?? 0
            await deps.store.setCompactFailureCount(session.chatId, prev + 1)
          }
        } else if (!active.cancelRequested) {
          await deps.store.recordTurnFinished(session.chatId)
          if (isProactiveCompactTurn(active)) {
            await deps.store.setCompactFailureCount(session.chatId, 0)
          }
          // Turn is already recorded finished, so a slow parse cannot hold it
          // open. Runs before maybeStartNextQueuedMessage below so the
          // correction it may enqueue is what that drain picks up.
          await deps.mermaidGuard?.check(session.chatId, turnAssistantText)
          // Note: pending-workflow harvest wake removed — workflow-completion
          // notification is a follow-up ADR. Model can delegate a status-check
          // subagent if it needs event-driven workflow wake.
        }
        deps.pendingTools.discard(session.chatId)
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

      if (event.entry.kind === "result") turnAssistantText = []

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
    const resident = deps.claudeSessions.get(session.chatId)
    const isCurrentSession = resident === session
    // A LATER session took this chat over (cancel-then-steer, oauth rotation).
    // Its bookkeeping is not ours to touch. Distinct from simply not being
    // resident, which is what an out-of-band teardown leaves behind.
    const supersededBySession = resident !== undefined && !isCurrentSession
    // Whether the chat's turn is OURS. The session map cannot answer this:
    // every teardown outside this runner deletes the entry first, so
    // `isCurrentSession` reads false for a session whose turn is still live.
    // A turn that declares no session (a provider that runs without one, or a
    // turn built before this binding existed) falls back to the old residency
    // rule — never worse than the previous behaviour, and never a turn left
    // unsettled because the binding happened to be missing.
    const ownsActiveTurn = active !== undefined
      && (active.sessionId === undefined ? isCurrentSession : active.sessionId === session.id)
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
    // Each clause below settles exactly what belongs to THIS session, and
    // nothing that a successor installed under the same chatId — wiping a
    // fresh session's bookkeeping leaves its stream running headless (no
    // isError branch fires → sessionToken never cleared → the next turn loops
    // on the same too-large --resume context).
    if (isCurrentSession) {
      deps.claudeSessions.delete(session.chatId)
      deps.oauthPool?.release(session.chatId)
    }
    // Settling the turn keys on ownership, NOT residency. An out-of-band
    // teardown (budget eviction, idle reap, `/clear`) unregisters the session
    // before this runs, and gating here on residency skipped the fail-close
    // altogether: the turn never ended, the chat reported busy forever, and
    // no terminal event reached `onTurnTerminal` — which is how cron runs
    // stopped being attributed and stalled at "running".
    if (ownsActiveTurn && active.provider === "claude") {
      if (active.cancelRequested && !active.cancelRecorded) {
        await deps.store.recordTurnCancelled(session.chatId)
      } else if (!active.hasFinalResult) {
        // Stream ended without any terminal result event (PTY died,
        // SDK transport dropped, evicted mid-turn, etc). Fail-close the turn
        // so the UI stops showing "running" forever. Without this the chat is
        // wedged until the user manually clicks Stop or reloads.
        log.warn("[kanna/agent] stream ended with no final result — recording turn failure", { chatId: session.chatId, sessionId: session.id })
        await deps.store.recordTurnFailed(session.chatId, "session stream ended without a result")
      }
      deps.activeTurns.delete(session.chatId)
    }
    // The session's provider worker dies with the stream — any parked
    // canUseTool continuation is unreachable from here on. Settle it so the
    // question card clears and the chat cannot report busy forever. A
    // successor owns its own parked requests, so stand down for one.
    if (!supersededBySession) {
      deps.pendingTools.discard(session.chatId)
    }
    session.selfWakeActive = false
    session.session.close()
    deps.emitStateChange(session.chatId)
  }
}
