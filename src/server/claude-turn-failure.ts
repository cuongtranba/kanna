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
  conversationMissing: boolean
  promptTooLong: boolean
}

export type FailureOutcome = "handled" | "unhandled" | "retry_on_fresh_session"

type FailedTurn =
  | { kind: "result"; text: string; debugRaw: string }
  | { kind: "thrown"; error: Error }

type HandledFailureLabel = "rate_limit" | "auth_error"

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
  const texts = [resultText, debugRaw]
  return {
    limit,
    auth,
    conversationMissing: texts.some(isNoConversationFoundMessage),
    promptTooLong: texts.some(isPromptTooLongMessage),
  }
}

function classifyThrownFailure(
  detectors: FailureDetectors,
  chatId: string,
  error: Error,
): TurnFailure {
  const limit = detectors.limit.detect(chatId, error)
  const auth = limit ? null : detectors.auth.detect(chatId, error)
  return {
    limit,
    auth,
    conversationMissing: isNoConversationFoundMessage(error.message),
    promptTooLong: isPromptTooLongMessage(error.message),
  }
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
  freshSessionRetryAvailable = false,
): Promise<FailureOutcome> {
  const failure = failed.kind === "result"
    ? classifyResultFailure(settlement, session.chatId, failed.text, failed.debugRaw)
    : classifyThrownFailure(settlement, session.chatId, failed.error)
  const label = await handleDetectedFailure(settlement, session, failure)
  if (!recordOutcome) return label !== null ? "handled" : "unhandled"
  if (label !== null) {
    await settlement.recordTurnFailed(session.chatId, label)
    return "handled"
  }
  if (failure.conversationMissing && freshSessionRetryAvailable) {
    await settlement.discardInvalidSession(session)
    return "retry_on_fresh_session"
  }
  if (failed.kind === "result") await settlement.recordTurnFailed(session.chatId, failed.text)
  else await settlement.recordTurnError(session.chatId, failed.error.message)
  if (failure.conversationMissing || failure.promptTooLong) await settlement.discardInvalidSession(session)
  return "unhandled"
}
