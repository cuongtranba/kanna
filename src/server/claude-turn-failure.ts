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

export interface FailureHandlers {
  handleLimitDetection(chatId: string, detection: LimitDetection): Promise<boolean>
  handleAuthFailure(session: ClaudeSessionState, detection: AuthErrorDetection): Promise<boolean>
}

function isSessionInvalid(...texts: readonly string[]): boolean {
  return texts.some((text) => isPromptTooLongMessage(text) || isNoConversationFoundMessage(text))
}

export function classifyResultFailure(
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

export function classifyThrownFailure(
  detectors: FailureDetectors,
  chatId: string,
  error: Error,
): TurnFailure {
  const limit = detectors.limit.detect(chatId, error)
  const auth = limit ? null : detectors.auth.detect(chatId, error)
  return { limit, auth, sessionInvalid: isSessionInvalid(error.message) }
}

export async function handleDetectedFailure(
  handlers: FailureHandlers,
  session: ClaudeSessionState,
  failure: TurnFailure,
): Promise<boolean> {
  if (failure.limit) return handlers.handleLimitDetection(session.chatId, failure.limit)
  if (failure.auth) return handlers.handleAuthFailure(session, failure.auth)
  return false
}

export function handledFailureLabel(failure: TurnFailure): "rate_limit" | "auth_error" {
  return failure.limit ? "rate_limit" : "auth_error"
}
