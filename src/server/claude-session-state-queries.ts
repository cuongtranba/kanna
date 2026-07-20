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

import type { AgentProvider, KannaStatus, PendingToolSnapshot } from "../shared/types"
import type { ActiveTurn, ClaudeSessionState } from "./claude-session-state"

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

export interface SessionStateQueryDeps {
  /** Live turn state keyed by chatId. */
  activeTurns: Map<string, ActiveTurn>
  /** Live Claude session state keyed by chatId. */
  claudeSessions: Map<string, ClaudeSessionState>
  /** Streams currently draining (only `.keys()` is consumed). */
  drainingStreams: { keys(): IterableIterator<string> }
  /** chatIds with a slash-commands load in-flight. */
  slashCommandsInFlight: ReadonlySet<string>
  /** Returns true when the given provider is a Claude SDK provider. */
  isClaudeSdkProvider: (provider: AgentProvider) => boolean
  /** Returns true when the session has a pending background Bash task. */
  hasPendingBackgroundTask: (session: ClaudeSessionState, now: number) => boolean
  /** Resolves the effective idle timeout in milliseconds. */
  resolveClaudeIdleMs: () => number
  /** Returns true when the chat has an in-flight Workflow. */
  hasLiveWorkflow: (chatId: string) => boolean
  /** Tears down and cleans up a Claude session. */
  closeClaudeSession: (chatId: string, session: ClaudeSessionState) => void
  /** Notifies subscribers that state has changed for the given chat. */
  emitStateChange: (chatId: string) => void
}

// ---------------------------------------------------------------------------
// Public query functions
// ---------------------------------------------------------------------------

/**
 * Returns a map of chatId → KannaStatus for all currently active turns.
 */
export function getActiveStatuses(deps: SessionStateQueryDeps): Map<string, KannaStatus> {
  const statuses = new Map<string, KannaStatus>()
  for (const [chatId, turn] of deps.activeTurns.entries()) {
    statuses.set(chatId, turn.status)
  }
  return statuses
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
  return out
}

/**
 * Returns the pending tool snapshot for the active turn in the given chat,
 * or null if there is no active turn or no pending tool.
 */
export function getPendingTool(
  deps: SessionStateQueryDeps,
  chatId: string,
): PendingToolSnapshot | null {
  const pending = deps.activeTurns.get(chatId)?.pendingTool
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
 * Returns the set of chatIds that have a slash-commands load in-flight.
 */
export function getSlashCommandsLoadingChatIds(deps: SessionStateQueryDeps): Set<string> {
  return new Set(deps.slashCommandsInFlight)
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
  if (session.pendingPromptSeqs.length > 0) return false
  if (deps.hasLiveWorkflow(chatId)) return false
  if (deps.hasPendingBackgroundTask(session, now)) return false
  return now - session.lastUsedAt >= deps.resolveClaudeIdleMs()
}

/**
 * Iterates all live Claude sessions and closes any that are idle.
 *
 * Mirrors the private `sweepIdleClaudeSessions` on AgentCoordinator.
 */
export function sweepIdleClaudeSessions(
  deps: SessionStateQueryDeps,
  now = Date.now(),
): void {
  for (const [chatId, session] of [...deps.claudeSessions.entries()]) {
    if (!isClaudeSessionIdle(deps, chatId, session, now)) continue
    deps.closeClaudeSession(chatId, session)
    deps.emitStateChange(chatId)
  }
}
