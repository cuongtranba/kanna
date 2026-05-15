export interface AuthErrorDetection {
  chatId: string
  reason: string
  raw: unknown
}

interface ErrorLike {
  message?: string
  status?: number
  api_error_status?: number
}

// Strings the Claude CLI / Anthropic API emit when an OAuth token is
// rejected. Covers both the JSON error envelope (`authentication_error`)
// and the CLI's surfaced result text (`Failed to authenticate.`). The
// `api_error_status: 401` form appears in JSONL `result` entries from
// the CLI when subscription auth fails.
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
  /**
   * Inspect a thrown error (from the SDK `query()` stream) for OAuth/auth
   * failure signals. Returns a detection when the token used for the
   * spawn has been rejected by the API — caller should mark the token as
   * errored and rotate.
   */
  detect(chatId: string, error: unknown): AuthErrorDetection | null {
    if (!error) return null
    const e = error as ErrorLike
    if (e.status === 401 || e.api_error_status === 401) {
      return { chatId, reason: this.summarize(e.message), raw: error }
    }
    const message = typeof e.message === "string" ? e.message : null
    if (message && isAuthErrorText(message)) {
      return { chatId, reason: this.summarize(message), raw: error }
    }
    return null
  }

  /**
   * Inspect the textual `result` field of a CLI JSONL `result` entry
   * (Claude Code's subprocess-level error surface). The CLI emits
   * `"api_error_status":401` and `"Failed to authenticate. API Error: 401
   * Invalid authentication credentials"` for OAuth rejection.
   */
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
