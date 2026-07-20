/**
 * Standalone turn-runner — extracted from AgentCoordinator.runTurn.
 *
 * Responsibilities:
 *   - Stream events from an in-flight HarnessTurn and write them to the store.
 *   - Handle cancellation, errors, and limit detection.
 *   - On completion: release OAuth pool token, emit state change, and kick off
 *     the next queued message or postToolFollowUp turn.
 *
 * Side-effect seal: this module contains NO direct IO (no node:fs, no HTTP
 * calls, no Bun primitives). Every effectful operation is injected through
 * RunTurnDeps so the module remains testable without a real coordinator.
 */

import type { AgentProvider, TranscriptEntry } from "../shared/types"
import type { AnyValue } from "../shared/errors"
import type { HarnessTurn } from "./harness-types"
import type { ActiveTurn } from "./claude-session-state"
import type { LimitDetector } from "./auto-continue/limit-detector"
import type { StartTurnForChatArgs } from "./claude-turn-starter"
import { timestamped } from "./claude-message-normalizer"

// ---------------------------------------------------------------------------
// Structural sub-interfaces — only the operations this module calls.
// ---------------------------------------------------------------------------

/** Subset of EventStore used by runTurn. */
interface RunTurnStore {
  setSessionTokenForProvider(
    chatId: string,
    provider: AgentProvider,
    sessionToken: string | null,
  ): Promise<void>
  getChat(chatId: string): { pendingForkSessionToken?: { provider: AgentProvider; token: string } | null } | null | undefined
  setPendingForkSessionToken(
    chatId: string,
    value: { provider: AgentProvider; token: string } | null,
  ): Promise<void>
  appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
  recordTurnFailed(chatId: string, error: string): Promise<void>
  recordTurnFinished(chatId: string): Promise<void>
  recordTurnCancelled(chatId: string): Promise<void>
}

/** Subset of OAuthTokenPool used by runTurn. */
interface RunTurnOAuthPool {
  release(chatId: string): void
}

// ---------------------------------------------------------------------------
// Dependency bundle
// ---------------------------------------------------------------------------

/**
 * All AgentCoordinator fields and callbacks accessed by runTurn.
 * Passed as a single deps object so the function stays testable without a
 * real coordinator.
 */
export interface RunTurnDeps {
  /** Structural subset of EventStore — no concrete import. */
  store: RunTurnStore
  /** Map of chatId → in-flight turn; mutated to reflect turn lifecycle. */
  activeTurns: Map<string, ActiveTurn>
  /** Map of chatId → draining stream; mutated when a result arrives early. */
  drainingStreams: Map<string, { turn: HarnessTurn }>
  /** OAuth pool for releasing the per-chat token reservation on completion. */
  oauthPool: RunTurnOAuthPool | null
  /** Detector for codex-side rate-limit / limit errors. */
  codexLimitDetector: LimitDetector
  /** Delegate to the coordinator's handleLimitError (already has detector bound via args). */
  handleLimitError: (chatId: string, detector: LimitDetector, error: AnyValue) => Promise<boolean>
  /** Notify the WebSocket layer that UI state changed. */
  emitStateChange: (chatId: string) => void
  /** Remove the draining-stream entry for a chat (coordinator keeps the map). */
  clearDrainingStream: (chatId: string) => void
  /** Spawn a follow-up turn for a chat (postToolFollowUp path). */
  startTurnForChat: (args: StartTurnForChatArgs) => Promise<void>
  /** Process the next queued message for a chat after the current turn ends. */
  maybeStartNextQueuedMessage: (chatId: string) => Promise<boolean | void>
}

// ---------------------------------------------------------------------------
// Standalone function
// ---------------------------------------------------------------------------

/**
 * Drive a single agentic turn to completion.
 *
 * Reads from `active.turn.stream`, writes transcript entries to the store,
 * and handles the full lifecycle: result detection, cancel recording, OAuth
 * token release, and post-turn scheduling (postToolFollowUp or queue drain).
 */
export async function runTurn(deps: RunTurnDeps, active: ActiveTurn): Promise<void> {
  try {
    for await (const event of active.turn.stream) {
      // Once cancelled, stop processing further stream events.
      // cancel() already removed us from activeTurns and notified the UI.
      if (active.cancelRequested) break

      if (event.type === "session_token" && event.sessionToken) {
        await deps.store.setSessionTokenForProvider(active.chatId, active.provider, event.sessionToken)
        const chat = deps.store.getChat(active.chatId)
        if (
          chat?.pendingForkSessionToken
          && event.sessionToken !== chat.pendingForkSessionToken.token
        ) {
          await deps.store.setPendingForkSessionToken(active.chatId, null)
        }
        deps.emitStateChange(active.chatId)
        continue
      }

      if (!event.entry) continue
      await deps.store.appendMessage(active.chatId, event.entry)

      if (event.entry.kind === "system_init") {
        active.status = "running"
      }

      if (event.entry.kind === "result") {
        active.hasFinalResult = true
        if (event.entry.isError) {
          await deps.store.recordTurnFailed(active.chatId, event.entry.result || "Turn failed")
        } else if (!active.cancelRequested) {
          await deps.store.recordTurnFinished(active.chatId)
        }
        // Remove from activeTurns as soon as the result arrives so the UI
        // transitions to idle immediately. The stream may still be open
        // (e.g. background tasks), but the user should be able to send
        // new messages without having to hit stop first.
        deps.activeTurns.delete(active.chatId)
        deps.drainingStreams.set(active.chatId, { turn: active.turn })
      }

      deps.emitStateChange(active.chatId)
    }
  } catch (error) {
    if (!active.cancelRequested) {
      const handled = await deps.handleLimitError(active.chatId, deps.codexLimitDetector, error)
      if (!handled) {
        const message = error instanceof Error ? error.message : String(error)
        await deps.store.appendMessage(
          active.chatId,
          timestamped({
            kind: "result",
            subtype: "error",
            isError: true,
            durationMs: 0,
            result: message,
          })
        )
        await deps.store.recordTurnFailed(active.chatId, message)
      } else {
        await deps.store.recordTurnFailed(active.chatId, "rate_limit")
      }
    }
  } finally {
    if (active.cancelRequested && !active.cancelRecorded) {
      await deps.store.recordTurnCancelled(active.chatId)
    }
    active.turn.close()
    // Only remove if we're still the active turn for this chat.
    // We may have already been removed by result handling or cancel(),
    // and a new turn may have started for the same chatId.
    if (deps.activeTurns.get(active.chatId) === active) {
      deps.activeTurns.delete(active.chatId)
    }
    // Stream has fully ended — no longer draining.
    deps.clearDrainingStream(active.chatId)
    // Turn-scoped reservation: release so another chat can claim this
    // token while this chat is idle. The rotation race between concurrent
    // in-flight turns is still serialized — both startClaudeTurn and the
    // pickActive() inside markLimited/markError run atomically in the JS
    // event loop, and a token marked limited/errored already drops its
    // reservation. The next turn for this chat reuses its existing claude
    // session (no re-pick) or pickActive again if it needs a fresh one.
    deps.oauthPool?.release(active.chatId)
    deps.emitStateChange(active.chatId)

    if (active.postToolFollowUp && !active.cancelRequested) {
      try {
        await deps.startTurnForChat({
          chatId: active.chatId,
          provider: active.provider,
          content: active.postToolFollowUp.content,
          attachments: [],
          model: active.model,
          effort: active.effort,
          serviceTier: active.serviceTier,
          planMode: active.postToolFollowUp.planMode,
          appendUserPrompt: false,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await deps.store.appendMessage(
          active.chatId,
          timestamped({
            kind: "result",
            subtype: "error",
            isError: true,
            durationMs: 0,
            result: message,
          })
        )
        await deps.store.recordTurnFailed(active.chatId, message)
        deps.emitStateChange(active.chatId)
      }
    } else if (!active.cancelRequested) {
      try {
        await deps.maybeStartNextQueuedMessage(active.chatId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await deps.store.appendMessage(
          active.chatId,
          timestamped({
            kind: "result",
            subtype: "error",
            isError: true,
            durationMs: 0,
            result: message,
          })
        )
        await deps.store.recordTurnFailed(active.chatId, message)
        deps.emitStateChange(active.chatId)
      }
    }
  }
}
