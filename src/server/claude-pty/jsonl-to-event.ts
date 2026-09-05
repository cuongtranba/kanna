import type { HarnessEvent } from "../harness-types"
import { log } from "../../shared/log"
import type { ContextWindowUsageSnapshot, ProviderUsage } from "../../shared/types"
import {
  type ClaudeRawSdkMessage,
  normalizeClaudeStreamMessage,
  normalizeClaudeUsageSnapshot,
  resolveFinalTurnUsage,
  maxClaudeContextWindowFromModelUsage,
  getClaudeAssistantMessageUsageId,
  timestamped,
} from "../agent"
import { ClaudeLimitDetector } from "./../auto-continue/limit-detector"
import { KANNA_MCP_SERVER_NAME } from "../../shared/tools"
import { isRecord } from "../../shared/errors"
import type { JsonObject } from "../../shared/json"

const KANNA_CHANNEL_TAG = `<channel source="${KANNA_MCP_SERVER_NAME}"`

type JsonlMessage = ClaudeRawSdkMessage & JsonObject

function extractSessionId(message: JsonlMessage): string | null {
  const snake = message.session_id
  if (typeof snake === "string" && snake.length > 0) return snake
  const camel = message.sessionId
  if (typeof camel === "string" && camel.length > 0) return camel
  return null
}

function extractNestedMemoryPath(message: JsonlMessage): string | null {
  if (message.type !== "nested_memory") return null
  const attachment = message.attachment
  if (!isRecord(attachment)) return null
  const path = attachment.path
  if (typeof path === "string" && path.length > 0) return path
  return null
}

const TERMINAL_STOP_REASONS = new Set(["end_turn", "stop_sequence", "max_tokens", "refusal"])

function assistantMessageId(message: JsonlMessage): string | undefined {
  const inner = message.message
  if (!isRecord(inner)) return undefined
  const id = inner.id
  return typeof id === "string" ? id : undefined
}

function hasTerminalStopReason(message: JsonlMessage): boolean {
  if (message.type !== "assistant") return false
  const inner = message.message
  if (!isRecord(inner)) return false
  const stop = inner.stop_reason
  return typeof stop === "string" && TERMINAL_STOP_REASONS.has(stop)
}

function userMessageContainsKannaChannel(message: JsonlMessage): boolean {
  const inner = message.message
  if (!isRecord(inner)) return false
  const content = inner.content
  if (typeof content === "string") return content.includes(KANNA_CHANNEL_TAG)
  if (Array.isArray(content)) {
    for (const block of content) {
      if (isRecord(block)) {
        const text = block.text
        if (typeof text === "string" && text.includes(KANNA_CHANNEL_TAG)) return true
      }
    }
  }
  return false
}

export interface JsonlEventParser {
  parse(rawLine: string): HarnessEvent[]
}

export interface CreateJsonlEventParserOptions {
  configuredContextWindow?: number
}

export function createJsonlEventParser(opts: CreateJsonlEventParserOptions = {}): JsonlEventParser {
  let seenAssistantUsageIds = new Set<string>()
  let latestUsageSnapshot: ContextWindowUsageSnapshot | null = null
  let lastKnownContextWindow: number | undefined = opts.configuredContextWindow
  const detector = new ClaudeLimitDetector()
  let turnState: "between" | "inTurn" | "inAutoWake" = "between"
  let pendingTurnEnd: { messageId: string | undefined } | null = null
  let suppressNextResultRow = false
  let apiErrorEmittedInTurn = false

  let pendingResultUsage: ProviderUsage | undefined
  let pendingResultCost: number | undefined

  return {
    parse(rawLine: string): HarnessEvent[] {
      const trimmed = rawLine.trim()
      if (!trimmed) return []
      let messageOrNull: JsonlMessage | null = null
      try {
        const raw: JsonlMessage = JSON.parse(trimmed)
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          messageOrNull = raw
        }
      } catch {
        log.warn("[claude-pty/jsonl] failed to parse line", trimmed.slice(0, 120))
      }
      if (!messageOrNull) return []
      const message = messageOrNull

      const isSidechain = message.isSidechain === true
      const isRealResultRow = !isSidechain && (
        message.type === "result"
        || (message.type === "system" && message.subtype === "turn_duration")
      )

      const events: HarnessEvent[] = []
      if (pendingTurnEnd) {
        const sameFinalMessage = !isSidechain
          && message.type === "assistant"
          && assistantMessageId(message) === pendingTurnEnd.messageId
        if (isRealResultRow) {
          pendingTurnEnd = null
        } else if (!sameFinalMessage) {
          const flushedMessageId = pendingTurnEnd.messageId
          pendingTurnEnd = null
          suppressNextResultRow = true
          const wasAutoWake = turnState === "inAutoWake"
          turnState = "between"
          if (!wasAutoWake) {
            const billed = latestUsageSnapshot
            const flushUsage = billed
              ? {
                  ...(billed.inputTokens !== undefined ? { inputTokens: billed.inputTokens } : {}),
                  ...(billed.outputTokens !== undefined ? { outputTokens: billed.outputTokens } : {}),
                  ...(billed.cachedInputTokens !== undefined ? { cachedInputTokens: billed.cachedInputTokens } : {}),
                }
              : undefined
            events.push({
              type: "transcript",
              entry: timestamped({
                kind: "result",
                messageId: flushedMessageId,
                subtype: "success" as const,
                isError: false,
                durationMs: 0,
                result: "",
                ...(flushUsage ? { usage: flushUsage } : {}),
                ...(billed?.costUsd !== undefined ? { costUsd: billed.costUsd } : {}),
              }),
            })
          }
          seenAssistantUsageIds = new Set<string>()
          latestUsageSnapshot = null
          pendingResultUsage = undefined
          pendingResultCost = undefined
        }
      }

      if (isSidechain) return events

      if (message.type === "user" || message.type === "assistant") {
        if (!isRealResultRow && suppressNextResultRow && !pendingTurnEnd) {
          suppressNextResultRow = false
        }
      }
      if (hasTerminalStopReason(message)) {
        pendingTurnEnd = { messageId: assistantMessageId(message) }
      }

      const isResultLine = message.type === "result"
        || (message.type === "system" && message.subtype === "turn_duration")
      if (message.type === "user") {
        const isKannaChannelPush = userMessageContainsKannaChannel(message)
        if (message.isMeta === true && turnState === "between" && !isKannaChannelPush) {
          turnState = "inAutoWake"
          return events
        }
        if (message.isMeta !== true || isKannaChannelPush) {
          turnState = "inTurn"
        }
      } else if (message.type === "assistant" && turnState === "between") {
        turnState = "inTurn"
      } else if (isResultLine) {
        if (turnState === "inAutoWake") {
          turnState = "between"
          return events
        }
        turnState = "between"
      }

      const sessionId = extractSessionId(message)
      if (sessionId) {
        events.push({ type: "session_token", sessionToken: sessionId })
      }

      const memoryPath = extractNestedMemoryPath(message)
      if (memoryPath) {
        events.push({
          type: "transcript",
          entry: timestamped({ kind: "memory_loaded", path: memoryPath }),
        })
      }

      if (message.type === "rate_limit_event") {
        const detection = detector.detectFromSdkRateLimitInfo(
          "",
          message.rate_limit_info ?? null,
        )
        if (detection) {
          events.push({ type: "rate_limit", rateLimit: { resetAt: detection.resetAt, tz: detection.tz } })
        }
      } else if (message.type === "system" && message.subtype === "rate_limit") {
        const resetAt = typeof message.resetAt === "number" ? message.resetAt : Date.now()
        const tz = typeof message.tz === "string" ? message.tz : "UTC"
        events.push({ type: "rate_limit", rateLimit: { resetAt, tz } })
      }

      if (message.type === "assistant") {
        const usageId = getClaudeAssistantMessageUsageId(message)
        const innerMessage = isRecord(message.message) ? message.message : undefined
        const usageSnapshot = normalizeClaudeUsageSnapshot(
          (innerMessage?.usage) ?? message.usage,
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

      if (message.type === "result") {
        const resultContextWindow = maxClaudeContextWindowFromModelUsage(
          message.modelUsage,
        )
        if (resultContextWindow !== undefined) {
          lastKnownContextWindow = Math.max(lastKnownContextWindow ?? 0, resultContextWindow)
        }
        const accumulatedUsage = normalizeClaudeUsageSnapshot(
          message.usage,
          lastKnownContextWindow,
        )
        const finalUsage = resolveFinalTurnUsage(
          latestUsageSnapshot,
          accumulatedUsage,
          lastKnownContextWindow,
        )

        const billed = accumulatedUsage ?? finalUsage
        pendingResultUsage = billed
          ? {
              ...(billed.inputTokens !== undefined ? { inputTokens: billed.inputTokens } : {}),
              ...(billed.outputTokens !== undefined ? { outputTokens: billed.outputTokens } : {}),
              ...(billed.cachedInputTokens !== undefined ? { cachedInputTokens: billed.cachedInputTokens } : {}),
            }
          : undefined
        const providerCostUsd =
          typeof message.total_cost_usd === "number"
            ? message.total_cost_usd
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
        const entries = normalizeClaudeStreamMessage(message)
        for (const entry of entries) {
          if (isRealResultRow && suppressNextResultRow && entry.kind === "result") {
            pendingResultUsage = undefined
            pendingResultCost = undefined
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
        log.warn("[claude-pty/jsonl] normalizeClaudeStreamMessage threw", String(err))
      }

      return events
    },
  }
}

export function parseJsonlLine(rawLine: string): HarnessEvent[] {
  const trimmed = rawLine.trim()
  if (!trimmed) return []
  let messageOrNull: JsonlMessage | null = null
  try {
    const raw: JsonlMessage = JSON.parse(trimmed)
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      messageOrNull = raw
    }
  } catch {
    log.warn("[claude-pty/jsonl] failed to parse line", trimmed.slice(0, 120))
  }
  if (!messageOrNull) return []
  const message = messageOrNull
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
    const entries = normalizeClaudeStreamMessage(message)
    for (const entry of entries) {
      events.push({ type: "transcript", entry })
    }
  } catch (err) {
    log.warn("[claude-pty/jsonl] normalizeClaudeStreamMessage threw", String(err))
  }

  return events
}
