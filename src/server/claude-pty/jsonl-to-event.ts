import type { HarnessEvent } from "../harness-types"
import type { ContextWindowUsageSnapshot, ProviderUsage } from "../../shared/types"
import {
  normalizeClaudeStreamMessage,
  normalizeClaudeUsageSnapshot,
  resolveFinalTurnUsage,
  maxClaudeContextWindowFromModelUsage,
  getClaudeAssistantMessageUsageId,
  timestamped,
} from "../agent"
import { ClaudeLimitDetector } from "./../auto-continue/limit-detector"
import { KANNA_MCP_SERVER_NAME } from "../../shared/tools"

// Keep-alive subagent turns are delivered via a kanna channel push, which
// claude records as a `user isMeta:true` line tagged with this marker. Such a
// line is a real turn the main agent issued, NOT a background auto-wake.
const KANNA_CHANNEL_TAG = `<channel source="${KANNA_MCP_SERVER_NAME}"`

// Real on-disk transcript lines carry the session id as camelCase `sessionId`;
// SDK stream-json messages use snake_case `session_id`. Accept either so PTY
// chats persist a session token (without it, canForkChat stays false and the
// fork button is disabled).
function extractSessionId(message: Record<string, unknown>): string | null {
  const snake = message.session_id
  if (typeof snake === "string" && snake.length > 0) return snake
  const camel = message.sessionId
  if (typeof camel === "string" && camel.length > 0) return camel
  return null
}

// Claude Code records each auto-loaded memory/rule file (CLAUDE.md, nested
// CLAUDE.md, `.claude/rules/*.md`) as a `type:"nested_memory"` transcript line
// carrying `attachment.path`. Returns the path when present + non-empty, else
// null (malformed / future-shape lines drop silently — never throw).
function extractNestedMemoryPath(message: Record<string, unknown>): string | null {
  if (message.type !== "nested_memory") return null
  const attachment = message.attachment
  if (!attachment || typeof attachment !== "object") return null
  const path = (attachment as { path?: unknown }).path
  if (typeof path === "string" && path.length > 0) return path
  return null
}

// Claude CLI ≥ 2.1.x stopped writing `type:"system"` rows (turn_duration,
// init, compact_boundary) into the on-disk transcript JSONL. The only turn-end
// signal left is the final assistant message's `stop_reason` — every persisted
// row of that message (one row per content block) carries the same terminal
// value. "tool_use" / "pause_turn" mean the turn continues; null appears on
// synthetic API-error rows.
const TERMINAL_STOP_REASONS = new Set(["end_turn", "stop_sequence", "max_tokens", "refusal"])

function assistantMessageId(message: Record<string, unknown>): string | undefined {
  const inner = message.message
  if (!inner || typeof inner !== "object") return undefined
  const id = (inner as { id?: unknown }).id
  return typeof id === "string" ? id : undefined
}

function hasTerminalStopReason(message: Record<string, unknown>): boolean {
  if (message.type !== "assistant") return false
  const inner = message.message
  if (!inner || typeof inner !== "object") return false
  const stop = (inner as { stop_reason?: unknown }).stop_reason
  return typeof stop === "string" && TERMINAL_STOP_REASONS.has(stop)
}

function userMessageContainsKannaChannel(message: Record<string, unknown>): boolean {
  const inner = message.message
  if (!inner || typeof inner !== "object") return false
  const content = (inner as { content?: unknown }).content
  if (typeof content === "string") return content.includes(KANNA_CHANNEL_TAG)
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === "object") {
        const text = (block as { text?: unknown }).text
        if (typeof text === "string" && text.includes(KANNA_CHANNEL_TAG)) return true
      }
    }
  }
  return false
}

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
  // Track turn-boundary state to filter Claude Code's background auto-wake
  // turns. After a real turn ends, `useQueueProcessor` (claude-code/src/hooks/
  // useQueueProcessor.ts) may auto-spawn a follow-up turn by injecting a
  // synthetic `<task-notification>` user message with `isMeta:true`. Kanna
  // never issued a `chat_send` for this turn, so its `result` MUST NOT
  // consume a `pendingPromptSeq` (would steal a real user turn's seq) or
  // alter Kanna's turn lifecycle. Mid-turn `isMeta:true` injections
  // (FileReadTool metadata, token-budget continuation) appear AFTER an
  // assistant message and are NOT auto-wakes — their final result is real.
  let turnState: "between" | "inTurn" | "inAutoWake" = "between"
  // Pending turn-end from a terminal `stop_reason` assistant row (claude
  // ≥ 2.1.x format, see hasTerminalStopReason). The synthesized `result` is
  // flushed on the NEXT line that doesn't belong to the same assistant
  // message, so it lands after every transcript entry of the turn (the final
  // message's blocks are persisted as several rows sharing one id). In
  // practice claude writes session-state checkpoint rows (`last-prompt` /
  // `ai-title` / `mode` / `permission-mode`) immediately after the final
  // assistant rows, so the flush is prompt. A real `result` /
  // `system/turn_duration` row (SDK fixtures, older CLIs) supersedes the
  // pending flush; one arriving just after a flush is swallowed so a turn
  // never finalizes twice.
  let pendingTurnEnd: { messageId: string | undefined } | null = null
  let suppressNextResultRow = false
  // Rate-limit / api-error turns emit BOTH a synthetic assistant
  // `isApiErrorMessage` (→ `api_error` entry) AND a `result` whose body
  // repeats the same text. Track per-turn api_error emission so the trailing
  // result entry's body can be scrubbed; the duration footer still renders.
  let apiErrorEmittedInTurn = false

  // Per-turn billed token usage and cost to attach to the result entry.
  // Mirrors the SDK driver's pendingResultUsage/pendingResultCost pattern in
  // createClaudeHarnessStream so both drivers produce identical result entries.
  let pendingResultUsage: ProviderUsage | undefined
  let pendingResultCost: number | undefined

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

      const isSidechain = message.isSidechain === true
      const isRealResultRow = !isSidechain && (
        message.type === "result"
        || (message.type === "system" && message.subtype === "turn_duration")
      )

      // Flush (or supersede) a pending stop_reason turn-end before anything
      // else so the synthesized result precedes the current line's events.
      const events: HarnessEvent[] = []
      if (pendingTurnEnd) {
        const sameFinalMessage = !isSidechain
          && message.type === "assistant"
          && assistantMessageId(message) === pendingTurnEnd.messageId
        if (isRealResultRow) {
          // The real turn-end row wins — it produces the result below.
          pendingTurnEnd = null
        } else if (!sameFinalMessage) {
          const flushedMessageId = pendingTurnEnd.messageId
          pendingTurnEnd = null
          suppressNextResultRow = true
          const wasAutoWake = turnState === "inAutoWake"
          turnState = "between"
          if (!wasAutoWake) {
            events.push({
              type: "transcript",
              entry: timestamped({
                kind: "result",
                messageId: flushedMessageId,
                subtype: "success",
                isError: false,
                durationMs: 0,
                result: "",
              }),
            })
          }
        }
      }

      // Task subagents write their messages into the parent transcript with
      // isSidechain:true. They are not part of the main turn: a sidechain
      // `result` (or its TUI `turn_duration` synth) would shift the parent's
      // pending prompt seq and finalize the user turn early, and a sidechain
      // session_id would clobber the parent chat's claude session token.
      // (A sidechain line still triggers the pending flush above — the main
      // turn already ended; its result must not wait on subagent traffic.)
      if (isSidechain) return events

      // A new main-turn row means any swallowed-duplicate window is over.
      if (message.type === "user" || message.type === "assistant") {
        if (!isRealResultRow && suppressNextResultRow && !pendingTurnEnd) {
          suppressNextResultRow = false
        }
      }
      // Arm the pending turn-end on terminal stop_reason rows (refreshed for
      // each row of the same final message).
      if (hasTerminalStopReason(message)) {
        pendingTurnEnd = { messageId: assistantMessageId(message) }
      }

      // Auto-wake detection — see turnState comment above.
      const isResultLine = message.type === "result"
        || (message.type === "system" && message.subtype === "turn_duration")
      if (message.type === "user") {
        // A kanna channel push is a real turn (keep-alive multi-turn), even
        // though it arrives isMeta:true at a turn boundary. Only genuine
        // background auto-wakes (no kanna tag) get filtered.
        const isKannaChannelPush = userMessageContainsKannaChannel(message)
        if (message.isMeta === true && turnState === "between" && !isKannaChannelPush) {
          turnState = "inAutoWake"
          return events
        }
        if (message.isMeta !== true || isKannaChannelPush) {
          turnState = "inTurn"
        }
        // Mid-turn isMeta user (turnState === "inTurn") falls through — emit
        // normally; downstream consumers already handle synthetic user lines.
      } else if (message.type === "assistant" && turnState === "between") {
        // Defensive: assistant without a preceding user line — treat as the
        // start of a real turn so the upcoming result is emitted.
        turnState = "inTurn"
      } else if (isResultLine) {
        if (turnState === "inAutoWake") {
          turnState = "between"
          return events
        }
        turnState = "between"
      }

      // D3 — emit session_token for any message carrying a session_id, not
      // just `system/init`. Matches the SDK driver loop in
      // createClaudeHarnessStream (agent.ts).
      const sessionId = extractSessionId(message)
      if (sessionId) {
        events.push({ type: "session_token", sessionToken: sessionId })
      }

      // PTY-only: surface Claude Code's auto-loaded memory/rule files as a
      // `memory_loaded` transcript entry (the "Loaded CLAUDE.md / rule" lines a
      // native TUI prints). `normalizeClaudeStreamMessage` has no nested_memory
      // case, so this branch is the only emitter — keeping the SDK driver
      // unchanged (scope = PTY only).
      const memoryPath = extractNestedMemoryPath(message)
      if (memoryPath) {
        events.push({
          type: "transcript",
          entry: timestamped({ kind: "memory_loaded", path: memoryPath }),
        })
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
        // Claude's on-disk transcript nests the Anthropic message — id, content
        // AND usage — under `.message`. The SDK stream-json shape keeps `usage`
        // at the top level. Prefer the nested location (real interactive
        // sessions) and fall back to the flat one (SDK fixtures / parity).
        const innerMessage = (message as { message?: { usage?: unknown } }).message
        const usageSnapshot = normalizeClaudeUsageSnapshot(
          innerMessage?.usage ?? (message as { usage?: unknown }).usage,
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

        // Stash billed token figures for the result entry (populated below in
        // the entry loop). Mirrors createClaudeHarnessStream so both drivers
        // produce identical result entries. Prefer accumulatedUsage for tokens.
        const billed = accumulatedUsage ?? finalUsage
        pendingResultUsage = billed
          ? {
              ...(billed.inputTokens !== undefined ? { inputTokens: billed.inputTokens } : {}),
              ...(billed.outputTokens !== undefined ? { outputTokens: billed.outputTokens } : {}),
              ...(billed.cachedInputTokens !== undefined ? { cachedInputTokens: billed.cachedInputTokens } : {}),
            }
          : undefined
        const providerCostUsd =
          typeof (message as { total_cost_usd?: unknown }).total_cost_usd === "number"
            ? (message as { total_cost_usd: number }).total_cost_usd
            : undefined
        pendingResultCost = providerCostUsd

        if (finalUsage) {
          const usageWithCost =
            providerCostUsd !== undefined ? { ...finalUsage, costUsd: providerCostUsd } : finalUsage
          events.push({
            type: "transcript",
            entry: timestamped({ kind: "context_window_updated", usage: usageWithCost }),
          })
        }
        seenAssistantUsageIds = new Set<string>()
        latestUsageSnapshot = null
      }

      try {
        const entries = normalizeClaudeStreamMessage(parsed)
        for (const entry of entries) {
          // An old CLI writing `turn_duration` (or an SDK `result`) right
          // after a stop_reason flush is a duplicate turn-end — swallow it so
          // the turn never finalizes twice.
          if (isRealResultRow && suppressNextResultRow && (entry as { kind?: string }).kind === "result") {
            continue
          }
          if (entry.kind === "api_error") {
            apiErrorEmittedInTurn = true
            events.push({ type: "transcript", entry })
            continue
          }
          if (entry.kind === "result") {
            const scrubbed = entry.isError && apiErrorEmittedInTurn
              ? { ...entry, result: "" }
              : entry
            apiErrorEmittedInTurn = false
            const enriched = {
              ...scrubbed,
              ...(pendingResultUsage !== undefined ? { usage: pendingResultUsage } : {}),
              ...(pendingResultCost !== undefined ? { costUsd: pendingResultCost } : {}),
            }
            pendingResultUsage = undefined
            pendingResultCost = undefined
            events.push({ type: "transcript", entry: enriched })
            continue
          }
          events.push({ type: "transcript", entry })
        }
        if (isRealResultRow && suppressNextResultRow) {
          suppressNextResultRow = false
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

  if (message.type === "system" && message.subtype === "init") {
    const sessionId = extractSessionId(message)
    if (sessionId) events.push({ type: "session_token", sessionToken: sessionId })
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
