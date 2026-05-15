import type { HarnessEvent } from "../harness-types"
import { normalizeClaudeStreamMessage } from "../agent"

export function parseJsonlLine(rawLine: string): HarnessEvent[] {
  const trimmed = rawLine.trim()
  if (!trimmed) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    console.warn("[claude-pty/jsonl] failed to parse line", trimmed.slice(0, 120))
    return []
  }
  if (!parsed || typeof parsed !== "object") return []
  const message = parsed as Record<string, unknown>
  const events: HarnessEvent[] = []

  if (message.type === "system" && message.subtype === "init" && typeof message.session_id === "string") {
    events.push({ type: "session_token", sessionToken: message.session_id })
  }

  if (message.type === "system" && message.subtype === "rate_limit") {
    const resetAt = typeof message.resetAt === "number" ? message.resetAt : Date.now()
    const tz = typeof message.tz === "string" ? message.tz : "UTC"
    events.push({ type: "rate_limit", rateLimit: { resetAt, tz } })
  }

  try {
    const entries = normalizeClaudeStreamMessage(parsed)
    for (const entry of entries) {
      events.push({ type: "transcript", entry })
    }
  } catch (err) {
    console.warn("[claude-pty/jsonl] normalizeClaudeStreamMessage threw", err)
  }

  return events
}
