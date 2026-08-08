/**
 * Standalone session-state query helpers and idle-reaper for AgentCoordinator.
 *
 * Extracted from agent.ts so the query logic lives in its own testable module.
 * The coordinator delegates to these functions by passing an object literal
 * that satisfies `SessionStateQueryDeps`.
 *
 * Side-effect seal: this module contains NO direct IO (no node:fs, no HTTP
 * calls, no Bun primitives). Every effectful operation is injected through
 * the deps interface.
 */

import type { AgentProvider, ChatBackgroundTask, KannaStatus, PendingToolSnapshot } from "../shared/types"
import type { ActiveTurn, ClaudeSessionState, StartingTurn } from "./claude-session-state"
import type { PendingToolSlots } from "./pending-tool-slot"
import { backgroundTaskGuardExpired } from "./claude-session-lifecycle"

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

export interface SessionStateQueryDeps {
  /** Live turn state keyed by chatId. */
  activeTurns: Map<string, ActiveTurn>
  /** Turns whose provider session is still booting, keyed by chatId. */
  startingTurns: Map<string, StartingTurn>
  /** Parked AskUserQuestion / ExitPlanMode continuations keyed by chatId. */
  pendingTools: PendingToolSlots
  /** Live Claude session state keyed by chatId. */
  claudeSessions: Map<string, ClaudeSessionState>
  /** Streams currently draining (only `.keys()` is consumed). */
  drainingStreams: { keys(): IterableIterator<string> }
  /** Returns true when the given provider is a Claude SDK provider. */
  isClaudeSdkProvider: (provider: AgentProvider) => boolean
  /** Returns true when the session has a pending background Bash task. */
  hasPendingBackgroundTask: (session: ClaudeSessionState, now: number) => boolean
  /** Resolves the effective idle timeout in milliseconds. */
  resolveClaudeIdleMs: () => number
  /** Resolves the background-task keep-alive window in milliseconds. */
  resolveBackgroundTaskMaxMs: () => number
  /** Resolves the max watchdog wakes per background-task watch epoch. */
  resolveBackgroundTaskMaxWakes: () => number
  /** Returns true when the chat has an in-flight Workflow. */
  hasLiveWorkflow: (chatId: string) => boolean
  /** Tears down and cleans up a Claude session. */
  closeClaudeSession: (chatId: string, session: ClaudeSessionState) => void
  /** Notifies subscribers that state has changed for the given chat. */
  emitStateChange: (chatId: string) => void
  /**
   * Fire-and-forget: wake the warm session with a watchdog prompt so the
   * agent re-checks its still-pending background task(s) and reports to the
   * user. Must not throw (IO stays behind the deps seal).
   */
  wakeBackgroundTaskSession: (
    chatId: string,
    taskIds: string[],
    wakeNumber: number,
    maxWakes: number,
  ) => void
  /**
   * Fire-and-forget: post a visible chat message that the listed background
   * task(s) were abandoned because the session was reclaimed after the wake
   * budget ran out. The one guarantee this module keeps: a pending
   * background task never dies silently.
   */
  notifyBackgroundTasksAbandoned: (chatId: string, taskIds: string[]) => void
}

// ---------------------------------------------------------------------------
// Public query functions
// ---------------------------------------------------------------------------

/** Structural slice of coordinator state needed to answer "is this chat busy?". */
export interface ChatBusyDeps {
  activeTurns: { has(chatId: string): boolean }
  startingTurns: { has(chatId: string): boolean }
  pendingTools: { has(chatId: string): boolean }
  claudeSessions: { get(chatId: string): { selfWakeActive: boolean } | undefined }
}

/**
 * THE single derivation of "is this chat busy?" — every consumer that gates
 * on busyness (send queueing, queued-message drain) must call this instead of
 * combining the underlying maps itself. Busy means any of:
 *
 * - a live Kanna turn (`activeTurns`)
 * - a turn whose provider session is still booting (`startingTurns`)
 * - a parked AskUserQuestion / ExitPlanMode awaiting the user (`pendingTools`)
 * - a task-notification self-wake turn streaming on the warm session
 *
 * Ad-hoc combinations are how the ghost-turn era wedged chats: each consumer
 * read a different subset and disagreed about the same chat.
 */
export function isChatBusy(deps: ChatBusyDeps, chatId: string): boolean {
  return deps.activeTurns.has(chatId)
    || deps.startingTurns.has(chatId)
    || deps.pendingTools.has(chatId)
    || deps.claudeSessions.get(chatId)?.selfWakeActive === true
}

/**
 * Returns a map of chatId → KannaStatus for all currently active turns.
 *
 * Two states also render as busy without an ActiveTurn, and are folded in as
 * overlays (deriveStatus stays pure — no event-sourced timing state is touched):
 *
 * - A turn whose provider session is still BOOTING. `startTurnForChat` only
 *   registers the ActiveTurn after the spawn resolves, so without this the
 *   chat reported "idle" for seconds while the user watched a Stop button.
 * - Task-notification self-wake turns, which run on the warm Claude session
 *   with no turn_started/turn_finished events at all.
 */
export function getActiveStatuses(deps: SessionStateQueryDeps): Map<string, KannaStatus> {
  const statuses = new Map<string, KannaStatus>()
  for (const [chatId, turn] of deps.activeTurns.entries()) {
    statuses.set(chatId, turn.status)
  }
  for (const chatId of deps.startingTurns.keys()) {
    if (statuses.has(chatId)) continue
    statuses.set(chatId, "starting")
  }
  for (const chatId of deps.pendingTools.chatIds()) {
    if (statuses.has(chatId)) continue
    statuses.set(chatId, "waiting_for_user")
  }
  for (const [chatId, session] of deps.claudeSessions.entries()) {
    if (statuses.has(chatId)) continue
    if (session.selfWakeActive) statuses.set(chatId, "running")
  }
  return statuses
}

/**
 * Live Claude-Code background tasks per chat, shaped for the UI (mirrors
 * Claude Code's /tasks list). Sorted oldest-first so labels are stable.
 */
export function getBackgroundTasksByChatId(
  deps: SessionStateQueryDeps,
): Map<string, ChatBackgroundTask[]> {
  const out = new Map<string, ChatBackgroundTask[]>()
  for (const [chatId, session] of deps.claudeSessions.entries()) {
    if (session.backgroundTasks.size === 0) continue
    const tasks: ChatBackgroundTask[] = [...session.backgroundTasks.entries()]
      .map(([id, meta]) => ({
        id,
        taskType: meta.taskType,
        description: meta.description,
        startedAt: meta.startedAt,
      }))
      .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
    out.set(chatId, tasks)
  }
  return out
}

/**
 * Returns a map of chatId → waitStartedAt for turns that are currently
 * waiting (i.e. have a non-null waitStartedAt).
 */
export function getWaitStartedAtByChatId(deps: SessionStateQueryDeps): Map<string, number> {
  const out = new Map<string, number>()
  for (const [chatId, turn] of deps.activeTurns.entries()) {
    if (turn.waitStartedAt != null) out.set(chatId, turn.waitStartedAt)
  }
  for (const chatId of deps.pendingTools.chatIds()) {
    if (out.has(chatId)) continue
    const parked = deps.pendingTools.get(chatId)
    if (parked) out.set(chatId, parked.parkedAt)
  }
  return out
}

/**
 * Returns the pending tool snapshot for the given chat, or null when nothing
 * is parked. Turn-independent: a request parked during an SDK self-wake (no
 * ActiveTurn) surfaces exactly like one parked mid-turn.
 */
export function getPendingTool(
  deps: SessionStateQueryDeps,
  chatId: string,
): PendingToolSnapshot | null {
  const pending = deps.pendingTools.get(chatId)
  if (!pending) return null
  return { toolUseId: pending.toolUseId, toolKind: pending.tool.toolKind }
}

/**
 * Returns the set of chatIds whose streams are currently draining.
 */
export function getDrainingChatIds(deps: SessionStateQueryDeps): Set<string> {
  return new Set(deps.drainingStreams.keys())
}

/**
 * Snapshot of live Claude session states per chat. Used by the sidebar badge
 * selector. Chats not present in the returned map are implicitly `cold`.
 */
export function getClaudeSessionStates(
  deps: SessionStateQueryDeps,
): Map<string, "warming" | "active" | "idle"> {
  const out = new Map<string, "warming" | "active" | "idle">()
  const now = Date.now()
  for (const [chatId, session] of deps.claudeSessions) {
    const activeProv = deps.activeTurns.get(chatId)?.provider
    if (activeProv !== undefined && deps.isClaudeSdkProvider(activeProv)) {
      out.set(chatId, "active")
    } else if (session.selfWakeActive) {
      // A self-wake turn is streaming — genuinely active work, not warming.
      out.set(chatId, "active")
    } else if (deps.hasPendingBackgroundTask(session, now)) {
      // Held warm for a background Bash task — surface as "warming", not "idle".
      out.set(chatId, "warming")
    } else if (now - session.lastUsedAt >= deps.resolveClaudeIdleMs()) {
      out.set(chatId, "idle")
    } else {
      out.set(chatId, "warming")
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Idle-reaper helpers (private semantics preserved as package functions)
// ---------------------------------------------------------------------------

/**
 * Returns true when the given Claude session has no live activity and the
 * idle timeout has elapsed since it was last used.
 *
 * Mirrors the private `isClaudeSessionIdle` on AgentCoordinator.
 */
export function isClaudeSessionIdle(
  deps: SessionStateQueryDeps,
  chatId: string,
  session: ClaudeSessionState,
  now = Date.now(),
): boolean {
  const activeProv = deps.activeTurns.get(chatId)?.provider
  if (activeProv !== undefined && deps.isClaudeSdkProvider(activeProv)) return false
  // A parked question means the provider worker is BLOCKED inside canUseTool
  // — no entries stream, so lastUsedAt stales while the user reads the
  // question. Reaping here would kill the very session holding the parked
  // continuation.
  if (deps.pendingTools.has(chatId)) return false
  if (session.pendingPromptSeqs.length > 0) return false
  if (deps.hasLiveWorkflow(chatId)) return false
  if (deps.hasPendingBackgroundTask(session, now)) return false
  return now - session.lastUsedAt >= deps.resolveClaudeIdleMs()
}

/**
 * Escalate a session whose background-task keep-alive deadline lapsed while
 * task ids are still pending. Invariant: a pending background task never
 * dies silently (adr-20260801-background-task-wake-escalation).
 *
 * Reachable ONLY for a session with no SDK level signal — the PTY driver, an
 * old CLI, or the brief window before an SDK session's first
 * `background_tasks_changed` snapshot. A level-sourced session never expires
 * its guard, so it never lands here
 * (adr-20260808-background-task-level-signal-authoritative). In order:
 *
 * 1. Session visibly busy (active Claude turn / queued prompts / live
 *    workflow) — just re-arm the deadline; the activity itself will settle
 *    or re-arm the guard. No wake budget consumed.
 * 2. Wake budget left — consume one wake: re-arm the deadline and prompt
 *    the warm session to re-check its task(s) and report to the user.
 * 3. Budget exhausted — once the session is also time-idle, clear the
 *    guard, close the session (the CLI kills its child tasks on shutdown),
 *    and post a visible abandonment notice to the chat. While the session
 *    was recently active (a wake turn just ran), defer to the next sweep so
 *    an imminent settle self-wake still wins.
 */
function escalateExpiredBackgroundTaskGuard(
  deps: SessionStateQueryDeps,
  chatId: string,
  session: ClaudeSessionState,
  now: number,
): void {
  const activeProv = deps.activeTurns.get(chatId)?.provider
  const hasActiveClaudeTurn = activeProv !== undefined && deps.isClaudeSdkProvider(activeProv)
  const busy = hasActiveClaudeTurn
    || session.pendingPromptSeqs.length > 0
    || deps.hasLiveWorkflow(chatId)
  if (busy) {
    session.backgroundTaskDeadlineAt = now + deps.resolveBackgroundTaskMaxMs()
    return
  }
  const maxWakes = deps.resolveBackgroundTaskMaxWakes()
  if (session.backgroundTaskWakeCount < maxWakes) {
    session.backgroundTaskWakeCount += 1
    session.backgroundTaskDeadlineAt = now + deps.resolveBackgroundTaskMaxMs()
    deps.wakeBackgroundTaskSession(
      chatId,
      [...session.backgroundTasks.keys()],
      session.backgroundTaskWakeCount,
      maxWakes,
    )
    return
  }
  if (now - session.lastUsedAt < deps.resolveClaudeIdleMs()) return
  const abandonedIds = [...session.backgroundTasks.keys()]
  session.backgroundTasks.clear()
  session.backgroundTaskDeadlineAt = 0
  deps.closeClaudeSession(chatId, session)
  deps.notifyBackgroundTasksAbandoned(chatId, abandonedIds)
  deps.emitStateChange(chatId)
}

/**
 * Iterates all live Claude sessions; escalates expired background-task
 * guards (wake, never silent-close) and closes any remaining idle sessions.
 *
 * Mirrors the private `sweepIdleClaudeSessions` on AgentCoordinator.
 */
export function sweepIdleClaudeSessions(
  deps: SessionStateQueryDeps,
  now = Date.now(),
): void {
  for (const [chatId, session] of [...deps.claudeSessions.entries()]) {
    if (backgroundTaskGuardExpired(session, now)) {
      escalateExpiredBackgroundTaskGuard(deps, chatId, session, now)
      continue
    }
    if (!isClaudeSessionIdle(deps, chatId, session, now)) continue
    deps.closeClaudeSession(chatId, session)
    deps.emitStateChange(chatId)
  }
}
