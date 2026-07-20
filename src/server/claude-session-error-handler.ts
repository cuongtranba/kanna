/**
 * Standalone session error-response handlers for AgentCoordinator.
 *
 * Extracted from agent.ts so the four related private methods live in their
 * own testable module. The coordinator delegates to these functions by passing
 * an object literal that satisfies `SessionErrorHandlerDeps`.
 *
 * Side-effect seal: this module contains NO direct IO (no node:fs, no HTTP
 * calls, no Bun primitives). Every effectful operation is injected through
 * the deps interface.
 */

import type { TranscriptEntry } from "../shared/types"
import { AUTO_CONTINUE_EVENT_VERSION, type AutoContinueEvent } from "./auto-continue/events"
import type { LimitDetection, LimitDetector } from "./auto-continue/limit-detector"
import type { AuthErrorDetection } from "./auto-continue/auth-error-detector"
import { deriveChatSchedules, deriveLoopState } from "./auto-continue/read-model"
import { log } from "../shared/log"
import { type AnyValue } from "../shared/errors"
import type { OAuthTokenEntry } from "../shared/types"
import type { ActiveTurn, ClaudeSessionState } from "./claude-session-state"
import { timestamped } from "./claude-message-normalizer"

// ---------------------------------------------------------------------------
// Timing constants (same values as in agent.ts — moved here as the single
// source of truth for the error-handler subsystem).
// ---------------------------------------------------------------------------

/** Milliseconds to wait before firing a token-rotation auto-continue. Gives
 *  the new token a moment to "warm up" before the next turn starts. */
export const TOKEN_ROTATION_SCHEDULE_DELAY_MS = 100

/** Additional stagger per concurrent detector in the same herd window, so
 *  PTY cold-boots do not all race to spawn at the same instant. */
export const TOKEN_ROTATION_HERD_STAGGER_MS = 250

/** Window during which multiple detectors for the same token ID are treated
 *  as a single rotation event (herd deduplication). */
export const TOKEN_ROTATION_DEDUPE_WINDOW_MS = 5_000

// ---------------------------------------------------------------------------
// Structural sub-interfaces — only the operations this module calls.
// ---------------------------------------------------------------------------

/** Entry stored per-token in the deduplication map. */
export interface TokenRotationDedupeEntry {
  firstSeenAt: number
  staggerCount: number
}

/** Subset of OAuthTokenPool used by the error handlers. */
interface ErrorHandlerOAuthPool {
  markLimited(id: string, resetAt: number): void
  markError(id: string, message: string): void
  pickActive(reservedFor?: string): OAuthTokenEntry | null
  earliestUnlimit(): number | null
}

/** Subset of EventStore used by the error handlers. */
interface ErrorHandlerStore {
  getAutoContinueEvents(chatId: string): AutoContinueEvent[]
  appendAutoContinueEvent(event: AutoContinueEvent): Promise<void>
  recordTurnFailed(chatId: string, error: string): Promise<void>
  appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
}

// ---------------------------------------------------------------------------
// Dependency bundle injected by AgentCoordinator
// ---------------------------------------------------------------------------

export interface SessionErrorHandlerDeps {
  /**
   * Mutable map owned by AgentCoordinator tracking the first-seen time and
   * stagger count per token ID across rotation detectors in the same herd
   * window. Passed by reference so acquireRotationSlot can mutate it.
   */
  tokenRotationDedupe: Map<string, TokenRotationDedupeEntry>

  /** The live claudeSessions map owned by the coordinator (read-only). */
  claudeSessions: Pick<Map<string, ClaudeSessionState>, "get">

  /** Active turns map — `.get()` to check existence, `.delete()` to remove. */
  activeTurns: Pick<Map<string, ActiveTurn>, "get" | "delete">

  /** OAuth token pool, or null when no pool is configured. */
  oauthPool: ErrorHandlerOAuthPool | null

  /** EventStore — subset used by the error handlers. */
  store: ErrorHandlerStore

  /** Returns true when the chat has auto-resume enabled. */
  resolveAutoResumeFor(chatId: string): boolean

  /**
   * Appends an AutoContinueEvent to the store, notifies the schedule manager,
   * and emits a state-change event for the chat.
   */
  emitAutoContinueEvent(event: AutoContinueEvent): Promise<void>

  /**
   * Tears down the given Claude session (stops the subprocess, releases the
   * OAuth reservation unless keepReservation is set).
   */
  closeClaudeSession(
    chatId: string,
    session: ClaudeSessionState,
    opts?: { keepReservation?: boolean },
  ): void
}

// ---------------------------------------------------------------------------
// Exported standalone functions
// ---------------------------------------------------------------------------

/**
 * Acquire a rotation slot for the given token, returning an optional
 * extra scheduling delay and whether this is the first detector (to avoid
 * duplicate markLimited/markError calls).
 *
 * Multiple detectors for the same token ID within TOKEN_ROTATION_DEDUPE_WINDOW_MS
 * reuse the same slot; each additional caller gets an increasing stagger delay
 * so PTY cold-boots spread out instead of stampeding.
 */
export function acquireRotationSlot(
  deps: SessionErrorHandlerDeps,
  tokenId: string | null,
): { extraDelayMs: number; isFirst: boolean } {
  if (!tokenId) return { extraDelayMs: 0, isFirst: true }
  const now = Date.now()
  const existing = deps.tokenRotationDedupe.get(tokenId)
  if (!existing || now - existing.firstSeenAt > TOKEN_ROTATION_DEDUPE_WINDOW_MS) {
    deps.tokenRotationDedupe.set(tokenId, { firstSeenAt: now, staggerCount: 0 })
    return { extraDelayMs: 0, isFirst: true }
  }
  existing.staggerCount += 1
  return { extraDelayMs: existing.staggerCount * TOKEN_ROTATION_HERD_STAGGER_MS, isFirst: false }
}

/**
 * Thin wrapper: run the rate-limit detector against the raw error and, if a
 * detection fires, delegate to handleLimitDetection.
 *
 * Returns true when the error was recognised as a rate-limit and handled.
 */
export async function handleLimitError(
  deps: SessionErrorHandlerDeps,
  chatId: string,
  detector: LimitDetector,
  error: AnyValue,
): Promise<boolean> {
  const detection = detector.detect(chatId, error)
  if (!detection) return false
  return handleLimitDetection(deps, chatId, detection)
}

/**
 * Core rate-limit response:
 *   1. Guard against a duplicate: if a live schedule already exists, bail out.
 *   2. Mark the current token as limited in the pool.
 *   3. Pick a rotation target (another usable pool token).
 *   4. Emit an AutoContinueEvent (rotation, auto-resume, or proposed).
 *   5. When rotating: close the limited session so the next turn spawns with
 *      the new token; record the turn as failed.
 *   6. When not rotating: append an `auto_continue_prompt` transcript entry
 *      so the UI can show the schedule card.
 *
 * Returns true (the error was handled, do not log the raw error).
 */
export async function handleLimitDetection(
  deps: SessionErrorHandlerDeps,
  chatId: string,
  detection: LimitDetection,
): Promise<boolean> {
  const autoContinueEvents = deps.store.getAutoContinueEvents(chatId)
  const live = deriveChatSchedules(autoContinueEvents, chatId).liveScheduleId
  if (live !== null) return true

  // An armed loop implies auto-resume on rate limit: the loop is autonomous by
  // definition, so a proposal card waiting for a human click would stall it
  // for hours (observed in production). The stored loop prompt rides the
  // accepted event so the deferred wake re-injects the full loop discipline
  // even if the session was idle-reaped during the wait.
  const loop = deriveLoopState(autoContinueEvents, chatId)

  const session = deps.claudeSessions.get(chatId)
  const limitedTokenId = session?.activeTokenId ?? null
  const slot = acquireRotationSlot(deps, limitedTokenId)
  if (deps.oauthPool && limitedTokenId && slot.isFirst) {
    deps.oauthPool.markLimited(limitedTokenId, detection.resetAt)
  }
  const rotationTarget = deps.oauthPool?.pickActive(chatId) ?? null
  const canRotate = rotationTarget !== null
    && (!limitedTokenId || rotationTarget.id !== limitedTokenId)

  if (deps.oauthPool) {
    log.info("[oauth-pool] rate-limit detected", {
      chatId,
      markedLimitedTokenId: limitedTokenId,
      resetAt: new Date(detection.resetAt).toISOString(),
      tz: detection.tz,
      nextTokenId: rotationTarget?.id ?? null,
      canRotate,
      herdSlot: slot,
    })
  }

  const now = Date.now()
  const scheduleId = crypto.randomUUID()
  const base = { v: AUTO_CONTINUE_EVENT_VERSION, timestamp: now, chatId, scheduleId }

  // When no rotation is possible, "wait until rate-limit clears" means waiting
  // for the earliest token in the pool to become available again — not just
  // the current detection's resetAt, which would over-shoot if another pool
  // token has an earlier limitedUntil.
  const earliestPoolUnlimit = deps.oauthPool?.earliestUnlimit() ?? null
  const waitUntil = earliestPoolUnlimit !== null
    ? Math.min(detection.resetAt, earliestPoolUnlimit)
    : detection.resetAt

  let event: AutoContinueEvent
  if (canRotate) {
    event = {
      ...base,
      kind: "auto_continue_accepted",
      scheduledAt: now + TOKEN_ROTATION_SCHEDULE_DELAY_MS + slot.extraDelayMs,
      tz: detection.tz,
      source: "token_rotation",
      resetAt: detection.resetAt,
      detectedAt: now,
    }
  } else if (deps.resolveAutoResumeFor(chatId) || loop !== null) {
    event = {
      ...base,
      kind: "auto_continue_accepted",
      scheduledAt: waitUntil,
      tz: detection.tz,
      source: "auto_setting",
      resetAt: waitUntil,
      detectedAt: now,
      ...(loop !== null ? { prompt: loop.prompt } : {}),
    }
  } else {
    event = {
      ...base,
      kind: "auto_continue_proposed",
      detectedAt: now,
      resetAt: waitUntil,
      tz: detection.tz,
    }
  }

  await deps.emitAutoContinueEvent(event)
  if (canRotate && session) {
    // Tear down the session bound to the limited token so the next turn
    // spawns a fresh subprocess with the rotated token's credentials.
    // Without this, startClaudeTurn reuses the cached session and
    // sendPrompt is routed to the still-limited token's subprocess.
    // keepReservation: true — the `pickActive(chatId)` above already
    // claimed `rotationTarget` under this chatId; the default `release`
    // path would scan reservedBy for owner===chatId and drop it,
    // leaking the rotation's reservation (audit #9d).
    deps.closeClaudeSession(chatId, session, { keepReservation: true })
    const active = deps.activeTurns.get(chatId)
    if (active) {
      await deps.store.recordTurnFailed(chatId, "rate_limit")
      deps.activeTurns.delete(chatId)
    }
  }
  if (!canRotate) {
    await deps.store.appendMessage(chatId, timestamped({
      kind: "auto_continue_prompt",
      scheduleId,
    }))
  }

  return true
}

/**
 * Core auth-error response:
 *   1. Guard against a duplicate: if a live schedule already exists, bail out.
 *   2. Mark the current token as errored in the pool.
 *   3. Pick a rotation target.
 *   4. Emit an AutoContinueEvent (immediate rotation or proposed).
 *   5. When rotating: close the dead session so the next turn spawns with the
 *      new token; record the turn as failed.
 *   6. When not rotating: append an `auto_continue_prompt` transcript entry
 *      so the UI can prompt the user to fix their token pool.
 *
 * Returns true when the failure was handled (rotated or proposed),
 * false otherwise (caller logs the raw error).
 */
export async function handleAuthFailure(
  deps: SessionErrorHandlerDeps,
  session: ClaudeSessionState,
  detection: AuthErrorDetection,
): Promise<boolean> {
  const chatId = session.chatId
  const live = deriveChatSchedules(deps.store.getAutoContinueEvents(chatId), chatId).liveScheduleId
  if (live !== null) return true

  const erroredTokenId = session.activeTokenId
  const slot = acquireRotationSlot(deps, erroredTokenId)
  if (deps.oauthPool && erroredTokenId && slot.isFirst) {
    deps.oauthPool.markError(erroredTokenId, detection.reason)
  }
  const rotationTarget = deps.oauthPool?.pickActive(chatId) ?? null
  const canRotate = rotationTarget !== null
    && (!erroredTokenId || rotationTarget.id !== erroredTokenId)

  if (deps.oauthPool) {
    log.info("[oauth-pool] auth-error detected", {
      chatId,
      markedErrorTokenId: erroredTokenId,
      reason: detection.reason,
      nextTokenId: rotationTarget?.id ?? null,
      canRotate,
      herdSlot: slot,
    })
  }

  const now = Date.now()
  const scheduleId = crypto.randomUUID()
  const base = { v: AUTO_CONTINUE_EVENT_VERSION, timestamp: now, chatId, scheduleId }

  // Auth errors mean the token is dead, not throttled — rotate
  // immediately when possible, no wait window.
  const event: AutoContinueEvent = canRotate
    ? {
        ...base,
        kind: "auto_continue_accepted",
        scheduledAt: now + TOKEN_ROTATION_SCHEDULE_DELAY_MS + slot.extraDelayMs,
        tz: "system",
        source: "token_rotation",
        resetAt: now,
        detectedAt: now,
      }
    : {
        ...base,
        kind: "auto_continue_proposed",
        detectedAt: now,
        resetAt: now,
        tz: "system",
      }

  await deps.emitAutoContinueEvent(event)
  if (canRotate) {
    // Tear down the session bound to the dead token so the next turn
    // spawns a fresh subprocess with the rotated token in env.
    // keepReservation: true — `pickActive(chatId)` above already claimed
    // the rotation target under this chatId. The previous inline close +
    // delete pair sidestepped `closeClaudeSession` to avoid the
    // accidental release; route through the helper now that release is
    // opt-out, for symmetry with the rate-limit rotation path.
    deps.closeClaudeSession(chatId, session, { keepReservation: true })
    const active = deps.activeTurns.get(chatId)
    if (active) {
      await deps.store.recordTurnFailed(chatId, "auth_error")
      deps.activeTurns.delete(chatId)
    }
  }
  if (!canRotate) {
    await deps.store.appendMessage(chatId, timestamped({
      kind: "auto_continue_prompt",
      scheduleId,
    }))
  }

  return true
}
