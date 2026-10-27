
import type { TranscriptEntry } from "../shared/types"
import { AUTO_CONTINUE_EVENT_VERSION, type AutoContinueEvent } from "./auto-continue/events"
import type { LimitDetection, LimitDetector } from "./auto-continue/limit-detector"
import type { AuthErrorDetection } from "./auto-continue/auth-error-detector"
import { deriveChatSchedules, deriveLoopState, type LoopState } from "./auto-continue/read-model"
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

interface RotationFailure {
  chatId: string
  session: ClaudeSessionState | undefined
  markToken: (pool: ErrorHandlerOAuthPool, tokenId: string) => void
  logMessage: string
  logFields: (tokenId: string | null) => object
  tz: string
  rotationResetAt: (now: number) => number
  failureLabel: string
  fallbackEvent: (base: AutoContinueEventBase, now: number) => AutoContinueEvent
}

interface AutoContinueEventBase {
  v: typeof AUTO_CONTINUE_EVENT_VERSION
  timestamp: number
  chatId: string
  scheduleId: string
}

function hasLiveSchedule(deps: SessionErrorHandlerDeps, chatId: string): boolean {
  return deriveChatSchedules(deps.store.getAutoContinueEvents(chatId), chatId).liveScheduleId !== null
}

async function rotateOrPropose(deps: SessionErrorHandlerDeps, failure: RotationFailure): Promise<boolean> {
  const { chatId, session } = failure
  const failedTokenId = session?.activeTokenId ?? null
  const slot = acquireRotationSlot(deps, failedTokenId)
  if (deps.oauthPool && failedTokenId && slot.isFirst) {
    failure.markToken(deps.oauthPool, failedTokenId)
  }
  const rotationTarget = deps.oauthPool?.pickActive(chatId) ?? null
  const canRotate = rotationTarget !== null
    && (!failedTokenId || rotationTarget.id !== failedTokenId)

  if (deps.oauthPool) {
    log.info(failure.logMessage, {
      chatId,
      ...failure.logFields(failedTokenId),
      nextTokenId: rotationTarget?.id ?? null,
      canRotate,
      herdSlot: slot,
    })
  }

  const now = Date.now()
  const scheduleId = crypto.randomUUID()
  const base: AutoContinueEventBase = { v: AUTO_CONTINUE_EVENT_VERSION, timestamp: now, chatId, scheduleId }

  const event: AutoContinueEvent = canRotate
    ? {
        ...base,
        kind: "auto_continue_accepted",
        scheduledAt: now + TOKEN_ROTATION_SCHEDULE_DELAY_MS + slot.extraDelayMs,
        tz: failure.tz,
        source: "token_rotation",
        resetAt: failure.rotationResetAt(now),
        detectedAt: now,
      }
    : failure.fallbackEvent(base, now)

  await deps.emitAutoContinueEvent(event)
  if (canRotate && session) {
    deps.closeClaudeSession(chatId, session, { keepReservation: true })
    const active = deps.activeTurns.get(chatId)
    if (active) {
      await deps.store.recordTurnFailed(chatId, failure.failureLabel)
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

export async function handleLimitDetection(
  deps: SessionErrorHandlerDeps,
  chatId: string,
  detection: LimitDetection,
): Promise<boolean> {
  if (hasLiveSchedule(deps, chatId)) return true
  const loop = deriveLoopState(deps.store.getAutoContinueEvents(chatId), chatId)
  return rotateOrPropose(deps, {
    chatId,
    session: deps.claudeSessions.get(chatId),
    markToken: (pool, tokenId) => { pool.markLimited(tokenId, detection.resetAt) },
    logMessage: "[oauth-pool] rate-limit detected",
    logFields: (tokenId) => ({
      markedLimitedTokenId: tokenId,
      resetAt: new Date(detection.resetAt).toISOString(),
      tz: detection.tz,
    }),
    tz: detection.tz,
    rotationResetAt: () => detection.resetAt,
    failureLabel: "rate_limit",
    fallbackEvent: (base, now) => limitWaitEvent(deps, detection, loop, base, now),
  })
}

function limitWaitEvent(
  deps: SessionErrorHandlerDeps,
  detection: LimitDetection,
  loop: LoopState | null,
  base: AutoContinueEventBase,
  now: number,
): AutoContinueEvent {
  const earliestPoolUnlimit = deps.oauthPool?.earliestUnlimit() ?? null
  const waitUntil = earliestPoolUnlimit !== null
    ? Math.min(detection.resetAt, earliestPoolUnlimit)
    : detection.resetAt
  if (deps.resolveAutoResumeFor(base.chatId) || loop !== null) {
    return {
      ...base,
      kind: "auto_continue_accepted",
      scheduledAt: waitUntil,
      tz: detection.tz,
      source: "auto_setting",
      resetAt: waitUntil,
      detectedAt: now,
      ...(loop !== null ? { prompt: loop.prompt } : {}),
    }
  }
  return {
    ...base,
    kind: "auto_continue_proposed",
    detectedAt: now,
    resetAt: waitUntil,
    tz: detection.tz,
  }
}

export async function handleAuthFailure(
  deps: SessionErrorHandlerDeps,
  session: ClaudeSessionState,
  detection: AuthErrorDetection,
): Promise<boolean> {
  const chatId = session.chatId
  if (hasLiveSchedule(deps, chatId)) return true
  return rotateOrPropose(deps, {
    chatId,
    session,
    markToken: (pool, tokenId) => { pool.markError(tokenId, detection.reason) },
    logMessage: "[oauth-pool] auth-error detected",
    logFields: (tokenId) => ({ markedErrorTokenId: tokenId, reason: detection.reason }),
    tz: "system",
    rotationResetAt: (now) => now,
    failureLabel: "auth_error",
    fallbackEvent: (base, now) => ({
      ...base,
      kind: "auto_continue_proposed",
      detectedAt: now,
      resetAt: now,
      tz: "system",
    }),
  })
}
