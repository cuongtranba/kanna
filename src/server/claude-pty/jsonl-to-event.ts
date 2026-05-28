import type { HarnessEvent } from "../harness-types"
import type { ContextWindowUsageSnapshot } from "../../shared/types"
import {
  normalizeClaudeStreamMessage,
  normalizeClaudeUsageSnapshot,
  resolveFinalTurnUsage,
  maxClaudeContextWindowFromModelUsage,
  getClaudeAssistantMessageUsageId,
  timestamped,
} from "../agent"
import { ClaudeLimitDetector } from "./../auto-continue/limit-detector"

export interface JsonlEventParser {
  /** Parse one JSONL line; returns zero or more harness events. Stateful — updates internal usage / context-window tracking across calls. */
  parse(rawLine: string): HarnessEvent[]
}

export interface CreateJsonlEventParserOptions {
  /** Per-model context-window floor (e.g. 1_000_000 for `[1m]` models). */
  configuredContextWindow?: number
}

/**
 * Stateful JSONL → HarnessEvent parser. One instance per PTY session so
 * usage snapshots can be diffed across `assistant` → `result` messages,
 * matching the SDK driver's `createClaudeHarnessStream` shape.
 */
export function createJsonlEventParser(opts: CreateJsonlEventParserOptions = {}): JsonlEventParser {
  let seenAssistantUsageIds = new Set<string>()
  let latestUsageSnapshot: ContextWindowUsageSnapshot | null = null
  let lastKnownContextWindow: number | undefined = opts.configuredContextWindow
  const detector = new ClaudeLimitDetector()

  return {
    parse(rawLine: string): HarnessEvent[] {
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
      // Task subagents write their messages into the parent transcript with
      // isSidechain:true. They are not part of the main turn: a sidechain
      // `result` (or its TUI `turn_duration` synth) would shift the parent's
      // pending prompt seq and finalize the user turn early, and a sidechain
      // session_id would clobber the parent chat's claude session token.
      if (message.isSidechain === true) return []
      const events: HarnessEvent[] = []

      // D3 — emit session_token for any message carrying a session_id, not
      // just `system/init`. Matches the SDK driver loop in
      // createClaudeHarnessStream (agent.ts).
      if (typeof message.session_id === "string" && message.session_id.length > 0) {
        events.push({ type: "session_token", sessionToken: message.session_id })
      }

      // D2 — recognise both shapes:
      //   (a) the SDK-native `rate_limit_event` message Claude Code mirrors
      //       into JSONL when running under the agent SDK
      //   (b) legacy `system/rate_limit` shape kept for any older CLI build
      //       that emits it (existing kanna call sites).
      if (message.type === "rate_limit_event") {
        const detection = detector.detectFromSdkRateLimitInfo(
          "",
          (message as { rate_limit_info?: unknown }).rate_limit_info,
        )
        if (detection) {
          events.push({ type: "rate_limit", rateLimit: { resetAt: detection.resetAt, tz: detection.tz } })
        }
      } else if (message.type === "system" && message.subtype === "rate_limit") {
        const resetAt = typeof message.resetAt === "number" ? message.resetAt : Date.now()
        const tz = typeof message.tz === "string" ? message.tz : "UTC"
        events.push({ type: "rate_limit", rateLimit: { resetAt, tz } })
      }

      // D1 — assistant message usage delta → context_window_updated.
      if (message.type === "assistant") {
        const usageId = getClaudeAssistantMessageUsageId(message)
        const usageSnapshot = normalizeClaudeUsageSnapshot(
          (message as { usage?: unknown }).usage,
          lastKnownContextWindow,
        )
        if (usageId && usageSnapshot && !seenAssistantUsageIds.has(usageId)) {
          seenAssistantUsageIds.add(usageId)
          latestUsageSnapshot = usageSnapshot
          events.push({
            type: "transcript",
            entry: timestamped({ kind: "context_window_updated", usage: usageSnapshot }),
          })
        }
      }

      // D1 — turn-end context window emit. Preserves the configured-window
      // floor so the SDK-internal `modelUsage.contextWindow` of 200_000
      // can't silently override a 1M-beta opt-in.
      if (message.type === "result") {
        const resultContextWindow = maxClaudeContextWindowFromModelUsage(
          (message as { modelUsage?: unknown }).modelUsage,
        )
        if (resultContextWindow !== undefined) {
          lastKnownContextWindow = Math.max(lastKnownContextWindow ?? 0, resultContextWindow)
        }
        const accumulatedUsage = normalizeClaudeUsageSnapshot(
          (message as { usage?: unknown }).usage,
          lastKnownContextWindow,
        )
        const finalUsage = resolveFinalTurnUsage(
          latestUsageSnapshot,
          accumulatedUsage,
          lastKnownContextWindow,
        )
        if (finalUsage) {
          events.push({
            type: "transcript",
            entry: timestamped({ kind: "context_window_updated", usage: finalUsage }),
          })
        }
        seenAssistantUsageIds = new Set<string>()
        latestUsageSnapshot = null
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
    },
  }
}

/**
 * Stateless wrapper kept for callers that don't need usage tracking.
 * Behaves the same as before D1/D2/D3 landed: no usage diff, no per-message
 * session_token. New callers should use `createJsonlEventParser` instead.
 */
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
  // Sidechain (Task subagent) lines never belong to the main turn stream.
  if (message.isSidechain === true) return []
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
