/**
 * Wiping a chat's provider context — the `/clear` effect.
 *
 * The claude-only half was the loop's private helper; it lives here now so the
 * loop path (`setup_loop`, background-subagent delivery) and the user-typed
 * `/clear` share ONE definition and cannot drift.
 *
 * Side-effect seal: no direct IO. Every effect arrives through the deps.
 */

import { AGENT_PROVIDERS, type AgentProvider } from "../shared/core-types"
import type { TranscriptEntry } from "../shared/types"
import { timestamped } from "./claude-message-normalizer"
import type { ClaudeSessionState } from "./claude-session-state"
import { isSessionInUse } from "./claude-session-state-queries"

export interface ClearClaudeContextDeps {
  store: {
    setSessionTokenForProvider(
      chatId: string,
      provider: AgentProvider,
      token: string | null,
    ): Promise<void>
  }
  claudeSessions: { get(chatId: string): ClaudeSessionState | undefined }
  activeTurns: { has(chatId: string): boolean }
  /** Turns still spawning their provider session — see the teardown guard. */
  startingTurns: { has(chatId: string): boolean }
  /** Parked AskUserQuestion / ExitPlanMode continuations — the worker is blocked inside canUseTool. */
  pendingTools: { has(chatId: string): boolean }
  /** Returns true when the chat has an in-flight Workflow. */
  hasLiveWorkflow: (chatId: string) => boolean
  /** Returns true when the session has a pending Claude-Code background task. */
  hasPendingBackgroundTask: (session: ClaudeSessionState, now: number) => boolean
  closeClaudeSession(chatId: string, session: ClaudeSessionState): void
}

export interface ClearChatContextDeps extends ClearClaudeContextDeps {
  store: ClearClaudeContextDeps["store"] & {
    appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
  }
  stopCodexSession(chatId: string): void
  emitStateChange(chatId: string): void
}

/**
 * Wipe the main-agent's Claude session context.
 *
 * Three things happen:
 * - The persisted session token is set to null (so the next spawn starts fresh).
 * - The live session's `suppressSessionTokenPersist` flag is set to true so the
 *   in-flight stream cannot overwrite the null we just wrote (avoids a
 *   121 ms race on setup_loop /clear).
 * - An idle warm SDK session is torn down so it cannot be reused in-band by
 *   the next turn (which would make the clear a no-op).
 *
 * "Idle" here means no turn is using the session — booting counts. Inline
 * cron re-checks `isChatBusy` and then awaits twice before calling this, so a
 * turn can legitimately start inside that window; closing its session then
 * kills the spawn, and because `closeClaudeSession` drops the map entry the
 * runner's fail-close never runs, stranding a ghost ActiveTurn.
 */
export async function clearClaudeSessionContext(
  deps: ClearClaudeContextDeps,
  chatId: string,
): Promise<void> {
  await deps.store.setSessionTokenForProvider(chatId, "claude", null)
  const session = deps.claudeSessions.get(chatId)
  if (!session) return
  session.suppressSessionTokenPersist = true
  if (!isSessionInUse(deps, chatId, session, Date.now())) {
    deps.closeClaudeSession(chatId, session)
  }
}

/**
 * Wipe every provider's context for a chat and mark the transcript.
 *
 * `stopCodexSession` is load-bearing, not hygiene: `CodexAppServerManager`
 * reuses a live session whenever the cwd matches and there is no pending fork
 * — it never consults the session token. Without the teardown, nulling the
 * token leaves the very next turn talking to the same thread.
 */
export async function clearChatContext(
  deps: ClearChatContextDeps,
  chatId: string,
): Promise<void> {
  for (const provider of AGENT_PROVIDERS) {
    if (provider === "claude") continue
    await deps.store.setSessionTokenForProvider(chatId, provider, null)
  }
  await clearClaudeSessionContext(deps, chatId)
  deps.stopCodexSession(chatId)
  await deps.store.appendMessage(chatId, timestamped({ kind: "context_cleared" }))
  deps.emitStateChange(chatId)
}
