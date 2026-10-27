import { normalizeAnthropicBaseUrl } from "../shared/anthropic-base-url"
import { OAUTH_TOKEN_BASE_URL_MAX } from "../shared/app-settings-types"
import { QUICK_RESPONSE_CLAUDE_MODEL } from "../shared/provider-model-types"

const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com"

const PROBE_TIMEOUT_MS = 10_000

export async function testOAuthToken(
  token: string,
  baseUrl?: string,
): Promise<{ ok: boolean; error: string | null }> {
  const trimmed = typeof token === "string" ? token.trim() : ""
  if (!trimmed) return { ok: false, error: "Token is empty" }
  const endpoint = (typeof baseUrl === "string" ? normalizeAnthropicBaseUrl(baseUrl, OAUTH_TOKEN_BASE_URL_MAX) : null)
    ?? ANTHROPIC_DEFAULT_BASE_URL
  try {
    const res = await fetch(`${endpoint}/v1/messages`, {
      method: "POST",
      headers: {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "authorization": `Bearer ${trimmed}`,
      },
      body: JSON.stringify({
        model: QUICK_RESPONSE_CLAUDE_MODEL,
        max_tokens: 1,
        messages: [{ role: "user", content: "ok" }],
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (res.status === 401 || res.status === 403) return { ok: false, error: "Unauthorized" }
    if (res.status === 429) return { ok: true, error: "Token valid but currently rate-limited" }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true, error: null }
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return { ok: false, error: `Request timed out after ${PROBE_TIMEOUT_MS / 1000}s` }
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
