/**
 * Standalone cancel handler for AgentCoordinator.
 *
 * Extracted from agent.ts so the chat-cancellation logic lives in its
 * own testable module. The coordinator delegates to `cancelChat` by
 * passing an object literal that satisfies `CancelHandlerDeps`.
 *
 * Side-effect seal: this module contains NO direct IO (no node:fs, no HTTP
 * calls, no Bun primitives). Every effectful operation is injected through
 * the deps interface.
 */

import type { ClaudeDriverPreference, TranscriptEntry } from "../shared/types"
import type { ActiveTurn, ClaudeSessionState, StartingTurn } from "./claude-session-state"
import type { HarnessTurn } from "./harness-types"
import { logClaudeSteer } from "./claude-steer-log"
import { discardedToolResult } from "./claude-sdk-queue"
import { timestamped } from "./claude-message-normalizer"

// ---------------------------------------------------------------------------
// Structural sub-interfaces — only the slices this module calls.
// ---------------------------------------------------------------------------

/** Subset of the draining-streams map used by the cancel handler. */
interface DrainingStreamsMap {
  get(chatId: string): { turn: HarnessTurn } | undefined
  delete(chatId: string): boolean
}

/** Subset of EventStore used by the cancel handler. */
interface CancelStore {
  appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
  recordTurnCancelled(chatId: string): Promise<void>
}

/** Subset of the activeTurns map used by the cancel handler. */
interface ActiveTurnsMap {
  get(chatId: string): ActiveTurn | undefined
  delete(chatId: string): boolean
}

/** Subset of the startingTurns map used by the cancel handler. */
interface StartingTurnsMap {
  get(chatId: string): StartingTurn | undefined
  delete(chatId: string): boolean
}

/** Subset of the claudeSessions map used by the cancel handler. */
interface ClaudeSessionsMap {
  get(chatId: string): ClaudeSessionState | undefined
}

// ---------------------------------------------------------------------------
// Dependency bundle injected by AgentCoordinator
// ---------------------------------------------------------------------------

export interface CancelHandlerDeps {
  /** The draining-streams map. The handler reads and deletes from it. */
  drainingStreams: DrainingStreamsMap

  /** Reject all pending `canUseTool` Promises waiting on user input for this chat. */
  rejectPendingResolversForChat(chatId: string): void

  /** Signal the subagent orchestrator to cancel all runs for this chat. */
  cancelChatInOrchestrator(chatId: string): void

  /** The active-turns map. The handler reads and deletes from it. */
  activeTurns: ActiveTurnsMap

  /**
   * Turns whose provider session is still booting (no `ActiveTurn` yet).
   * The handler marks and removes entries here so Stop lands during the
   * spawn window instead of no-oping.
   */
  startingTurns: StartingTurnsMap

  /** Store — for appending transcript entries and recording the cancelled turn. */
  store: CancelStore

  /** The claude-sessions map. Read-only from the handler's perspective. */
  claudeSessions: ClaudeSessionsMap

  /** Emit a state-change event for a chat. */
  emitStateChange(chatId: string): void

  /** Return the currently resolved Claude driver preference. */
  resolveClaudeDriverPreference(): ClaudeDriverPreference

  /**
   * Tear down a Claude session and (by default) release any OAuth-pool
   * reservation for this chat. Delegates to closeClaudeSession in
   * claude-session-lifecycle.ts.
   */
  closeClaudeSession(chatId: string, session: ClaudeSessionState): void
}

// ---------------------------------------------------------------------------
// Exported standalone function
// ---------------------------------------------------------------------------

/**
 * Cancel an active turn for a chat.
 *
 * 1. Closes any draining stream for the chat.
 * 2. Rejects pending `canUseTool` Promises and signals the subagent orchestrator.
 * 3. If there is no active turn, falls back in order to the two states that
 *    also render as busy: a turn whose provider session is still booting
 *    (`startingTurns`) and a task-notification self-wake turn on the warm
 *    session. Only a genuinely idle chat is a no-op.
 * 4. If there is an active turn:
 *    a. Guards against concurrent cancel calls.
 *    b. Discards any pending tool request and appends a `tool_result` entry.
 *    c. Appends an `interrupted` transcript entry and records `turn_cancelled`.
 *    d. Removes the turn from `activeTurns` so the UI reflects cancellation.
 *    e. Drains the cancelled prompt's seq from the Claude session's pending queue.
 *    f. Emits a state-change event.
 *    g. Interrupts and closes the underlying stream (best-effort, 5 s timeout).
 *    h. For PTY driver: drops the dead Claude session from the map.
 *
 * Never starts a queued message — see the closing comment.
 *
 * @param deps   Injected dependencies — all coordinator state arrives through here.
 * @param chatId The chat to cancel.
 * @param options
 *   - `hideInterrupted`  If true, the `interrupted` transcript entry is hidden.
 */
export async function cancelChat(
  deps: CancelHandlerDeps,
  chatId: string,
  options?: { hideInterrupted?: boolean },
): Promise<void> {
  // Also clean up any draining stream for this chat.
  const draining = deps.drainingStreams.get(chatId)
  if (draining) {
    draining.turn.close()
    deps.drainingStreams.delete(chatId)
  }

  // Reject any subagent canUseTool Promises waiting on a user response in
  // this chat, and signal the orchestrator. Both happen unconditionally —
  // a chat may have no active main-turn (e.g. just an @mention with the
  // main turn already ended) while subagents are still running. Without
  // this, the SDK's canUseTool callback hangs forever, wedging the
  // subagent session and leaking the resolver entry.
  deps.rejectPendingResolversForChat(chatId)
  deps.cancelChatInOrchestrator(chatId)

  const active = deps.activeTurns.get(chatId)
  if (!active) {
    // No ActiveTurn yet — but the turn may still be BOOTING. `startTurnForChat`
    // registers the ActiveTurn only after the provider session spawns (seconds
    // on a cold chat), and the composer shows Stop for that whole window. Mark
    // the starting turn so the booting turn tears itself down when the spawn
    // resolves, and give the user immediate feedback here rather than making
    // them wait out the boot.
    const starting = deps.startingTurns.get(chatId)
    if (starting) {
      starting.cancelRequested = true
      // Drop the marker so the chat reports idle on the very next snapshot.
      // `startTurnForChat` holds its own reference and re-checks the flag, and
      // its cleanup is identity-guarded, so removing it here is safe even if a
      // fresh turn starts before the old boot finishes.
      deps.startingTurns.delete(chatId)
      await deps.store.appendMessage(
        chatId,
        timestamped({ kind: "interrupted", hidden: options?.hideInterrupted }),
      )
      await deps.store.recordTurnCancelled(chatId)
      deps.emitStateChange(chatId)
      return
    }

    // No Kanna turn — but a task-notification self-wake turn may be
    // streaming on the warm session (surfaced as "running" by
    // getActiveStatuses). Stop must reach it: interrupt the session
    // stream directly, mirroring the active-turn path below.
    const session = deps.claudeSessions.get(chatId)
    if (session?.selfWakeActive) {
      session.selfWakeActive = false
      // The SDK answers interrupt() with a tail error result (subtype
      // error_during_execution, empty text); suppress it exactly like a
      // cancelled Kanna turn so it never renders as an unknown error.
      session.cancelledResultPending += 1
      await deps.store.appendMessage(
        chatId,
        timestamped({ kind: "interrupted", hidden: options?.hideInterrupted }),
      )
      deps.emitStateChange(chatId)
      try {
        await Promise.race([
          session.session.interrupt(),
          new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
        ])
      } catch {
        // best-effort — the flag is already cleared and the UI reflects idle
      }
      // PTY interrupt sends SIGINT which kills the CLI — drop the dead
      // session so the next turn respawns (same as the active-turn path).
      if (deps.resolveClaudeDriverPreference() === "pty") {
        deps.closeClaudeSession(chatId, session)
        deps.emitStateChange(chatId)
      }
    }
    return
  }

  logClaudeSteer("cancel_requested", {
    chatId,
    provider: active.provider,
    activePromptSeq: active.claudePromptSeq ?? null,
  })

  // Guard against concurrent cancel() calls — only the first one does work.
  if (active.cancelRequested) return
  active.cancelRequested = true

  const pendingTool = active.pendingTool
  active.pendingTool = null

  if (pendingTool) {
    const result = discardedToolResult(pendingTool.tool)
    await deps.store.appendMessage(
      chatId,
      timestamped({
        kind: "tool_result",
        toolId: pendingTool.toolUseId,
        content: result,
      }),
    )
    if (active.provider === "codex" && pendingTool.tool.toolKind === "exit_plan_mode") {
      pendingTool.resolve(result)
    }
  }

  await deps.store.appendMessage(
    chatId,
    timestamped({ kind: "interrupted", hidden: options?.hideInterrupted }),
  )
  await deps.store.recordTurnCancelled(chatId)
  active.cancelRecorded = true
  active.hasFinalResult = true

  // Remove from activeTurns immediately so the UI reflects the cancellation
  // right away, rather than waiting for interrupt() which may hang.
  deps.activeTurns.delete(chatId)

  // Drain the cancelled prompt's seq from the Claude session's pending
  // queue. The SDK does not always echo a `result.subtype=cancelled` for
  // an interrupted prompt — when the stream just ends, the seq would
  // otherwise linger and cause a FIFO mismatch when the next turn's
  // result arrives, leaving the chat stuck in "running".
  if (active.provider === "claude" && active.claudePromptSeq != null) {
    const session = deps.claudeSessions.get(chatId)
    if (session) {
      const idx = session.pendingPromptSeqs.indexOf(active.claudePromptSeq)
      if (idx >= 0) session.pendingPromptSeqs.splice(idx, 1)
      // The SDK driver's `interrupt()` emits a tail `result` with
      // subtype `error_during_execution` (empty text) after the splice
      // above. Mark it pending so runClaudeSession suppresses that one
      // result instead of rendering "An unknown error occurred." The
      // `interrupted` entry above is the user-visible cancellation.
      session.cancelledResultPending += 1
    }
  }

  deps.emitStateChange(chatId)
  logClaudeSteer("cancel_active_turn_deleted", {
    chatId,
    provider: active.provider,
    activePromptSeq: active.claudePromptSeq ?? null,
  })

  // Now attempt to interrupt/close the underlying stream in the background.
  // This is best-effort — the turn is already removed from active state above,
  // and runTurn()'s finally block will also call close().
  try {
    await Promise.race([
      active.turn.interrupt(),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ])
  } catch {
    // interrupt() failed — force close
  }
  active.turn.close()

  // For Claude under the PTY driver, `active.turn` is a ghost facade over
  // the long-lived `claudeSessions` entry and its `close()` is a no-op.
  // The PTY driver's `interrupt()` sends SIGINT which terminates the CLI,
  // so the underlying session is dead — drop it from the map so the next
  // turn respawns a fresh `claude --resume <sessionToken>` (preserves
  // transcript context). For the SDK driver, `interrupt()` is honored
  // in-band without killing the worker, so reuse is still valid.
  if (active.provider === "claude" && deps.resolveClaudeDriverPreference() === "pty") {
    const session = deps.claudeSessions.get(chatId)
    if (session) {
      deps.closeClaudeSession(chatId, session)
    }
  }

  // Deliberately NO queue drain here. Stop means stop: handing the chat
  // straight to the next queued message put it back into "running" in the
  // same tick, so Stop appeared to need a second press. Queued messages stay
  // parked with their "Send now" / "Remove" actions; a turn that ends
  // normally still drains them (see claude-turn-runner.ts, which likewise
  // skips the drain when cancelRequested is set).
}
