import type { JsonValue } from "../../shared/json"

export interface AuthErrorDetection {
  chatId: string
  reason: string
  raw: Error | JsonValue
}

interface ErrorLike {
  readonly message?: string
  readonly status?: JsonValue
  readonly api_error_status?: JsonValue
}

const AUTH_ERROR_PATTERNS = [
  /api_error_status[^,}]*\s*:\s*401/i,
  /401\s+Invalid authentication credentials/i,
  /Failed to authenticate\.\s*API Error:\s*401/i,
  /"type"\s*:\s*"authentication_error"/i,
  /"error"\s*:\s*"authentication_failed"/i,
] as const

function isAuthErrorText(text: string): boolean {
  return AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(text))
}

export class ClaudeAuthErrorDetector {
  detect(chatId: string, error: Error): AuthErrorDetection | null {
    const e: ErrorLike = error
    if (e.status === 401 || e.api_error_status === 401) {
      return { chatId, reason: this.summarize(e.message), raw: error }
    }
    const message = typeof e.message === "string" ? e.message : null
    if (message && isAuthErrorText(message)) {
      return { chatId, reason: this.summarize(message), raw: error }
    }
    return null
  }

  detectFromResultText(chatId: string, text: string): AuthErrorDetection | null {
    if (typeof text !== "string" || text.length === 0) return null
    if (!isAuthErrorText(text)) return null
    return { chatId, reason: this.summarize(text), raw: text }
  }

  private summarize(message: string | undefined): string {
    if (!message) return "401 authentication error"
    return message.length > 200 ? `${message.slice(0, 200)}…` : message
  }
}
