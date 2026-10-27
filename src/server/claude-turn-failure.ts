import type { LimitDetection, LimitDetector } from "./auto-continue/limit-detector"
import type { AuthErrorDetection } from "./auto-continue/auth-error-detector"
import { isNoConversationFoundMessage, isPromptTooLongMessage } from "./claude-prompt-helpers"
import type { ClaudeSessionState } from "./claude-session-state"

export interface AuthErrorDetectable {
  detect(chatId: string, error: Error): AuthErrorDetection | null
  detectFromResultText(chatId: string, text: string): AuthErrorDetection | null
}

export interface FailureDetectors {
  limit: LimitDetector
  auth: AuthErrorDetectable
}

export interface TurnFailure {
  limit: LimitDetection | null
  auth: AuthErrorDetection | null
  sessionInvalid: boolean
}

type FailedTurn =
  | { kind: "result"; text: string; debugRaw: string }
  | { kind: "thrown"; error: Error }

type HandledFailureLabel = "rate_limit" | "auth_error"

function isSessionInvalid(...texts: readonly string[]): boolean {
  return texts.some((text) => isPromptTooLongMessage(text) || isNoConversationFoundMessage(text))
}

function classifyResultFailure(
  detectors: FailureDetectors,
  chatId: string,
  resultText: string,
  debugRaw: string,
): TurnFailure {
  const limit = detectors.limit.detectFromResultText?.(chatId, resultText) ?? null
  const auth = limit
    ? null
    : detectors.auth.detectFromResultText(chatId, resultText)
      ?? detectors.auth.detectFromResultText(chatId, debugRaw)
  return { limit, auth, sessionInvalid: isSessionInvalid(resultText, debugRaw) }
}

function classifyThrownFailure(
  detectors: FailureDetectors,
  chatId: string,
  error: Error,
): TurnFailure {
  const limit = detectors.limit.detect(chatId, error)
  const auth = limit ? null : detectors.auth.detect(chatId, error)
  return { limit, auth, sessionInvalid: isSessionInvalid(error.message) }
}

export interface FailureHandlers {
  handleLimitDetection(chatId: string, detection: LimitDetection): Promise<boolean>
  handleAuthFailure(session: ClaudeSessionState, detection: AuthErrorDetection): Promise<boolean>
}

export interface FailureSettlement extends FailureDetectors, FailureHandlers {
  recordTurnFailed(chatId: string, reason: string): Promise<void>
  recordTurnError(chatId: string, message: string): Promise<void>
  discardInvalidSession(session: ClaudeSessionState): Promise<void>
}

async function handleDetectedFailure(
  handlers: FailureHandlers,
  session: ClaudeSessionState,
  failure: TurnFailure,
): Promise<HandledFailureLabel | null> {
  if (failure.limit) return (await handlers.handleLimitDetection(session.chatId, failure.limit)) ? "rate_limit" : null
  if (failure.auth) return (await handlers.handleAuthFailure(session, failure.auth)) ? "auth_error" : null
  return null
}

export async function settleFailedTurn(
  settlement: FailureSettlement,
  session: ClaudeSessionState,
  failed: FailedTurn,
  recordOutcome: boolean,
): Promise<boolean> {
  const failure = failed.kind === "result"
    ? classifyResultFailure(settlement, session.chatId, failed.text, failed.debugRaw)
    : classifyThrownFailure(settlement, session.chatId, failed.error)
  const label = await handleDetectedFailure(settlement, session, failure)
  if (!recordOutcome) return label !== null
  if (label !== null) {
    await settlement.recordTurnFailed(session.chatId, label)
    return true
  }
  if (failed.kind === "result") await settlement.recordTurnFailed(session.chatId, failed.text)
  else await settlement.recordTurnError(session.chatId, failed.error.message)
  if (failure.sessionInvalid) await settlement.discardInvalidSession(session)
  return false
}
