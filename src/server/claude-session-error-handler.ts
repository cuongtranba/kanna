
import type { TranscriptEntry } from "../shared/types"
import { AUTO_CONTINUE_EVENT_VERSION, type AutoContinueEvent } from "./auto-continue/events"
import type { LimitDetection, LimitDetector } from "./auto-continue/limit-detector"
import type { AuthErrorDetection } from "./auto-continue/auth-error-detector"
import { deriveChatSchedules, deriveLoopState } from "./auto-continue/read-model"
import { log } from "../shared/log"
import type { OAuthTokenEntry } from "../shared/types"
import type { ActiveTurn, ClaudeSessionState } from "./claude-session-state"
import { timestamped } from "./claude-message-normalizer"


export const TOKEN_ROTATION_SCHEDULE_DELAY_MS = 100

export const TOKEN_ROTATION_HERD_STAGGER_MS = 250

export const TOKEN_ROTATION_DEDUPE_WINDOW_MS = 5_000


export interface TokenRotationDedupeEntry {
  firstSeenAt: number
  staggerCount: number
}

interface ErrorHandlerOAuthPool {
  markLimited(id: string, resetAt: number): void
  markError(id: string, message: string): void
  pickActive(reservedFor?: string): OAuthTokenEntry | null
  earliestUnlimit(): number | null
}

interface ErrorHandlerStore {
  getAutoContinueEvents(chatId: string): AutoContinueEvent[]
  appendAutoContinueEvent(event: AutoContinueEvent): Promise<void>
  recordTurnFailed(chatId: string, error: string): Promise<void>
  appendMessage(chatId: string, entry: TranscriptEntry): Promise<void>
}


export interface SessionErrorHandlerDeps {
  tokenRotationDedupe: Map<string, TokenRotationDedupeEntry>

  claudeSessions: Pick<Map<string, ClaudeSessionState>, "get">

  activeTurns: Pick<Map<string, ActiveTurn>, "get" | "delete">

  oauthPool: ErrorHandlerOAuthPool | null

  store: ErrorHandlerStore

  resolveAutoResumeFor(chatId: string): boolean

  emitAutoContinueEvent(event: AutoContinueEvent): Promise<void>

  closeClaudeSession(
    chatId: string,
    session: ClaudeSessionState,
    opts?: { keepReservation?: boolean },
  ): void
}


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

export async function handleLimitError(
  deps: SessionErrorHandlerDeps,
  chatId: string,
  detector: LimitDetector,
  error: Error,
): Promise<boolean> {
  const detection = detector.detect(chatId, error)
  if (!detection) return false
  return handleLimitDetection(deps, chatId, detection)
}

export async function handleLimitDetection(
  deps: SessionErrorHandlerDeps,
  chatId: string,
  detection: LimitDetection,
): Promise<boolean> {
  const autoContinueEvents = deps.store.getAutoContinueEvents(chatId)
  const live = deriveChatSchedules(autoContinueEvents, chatId).liveScheduleId
  if (live !== null) return true

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
