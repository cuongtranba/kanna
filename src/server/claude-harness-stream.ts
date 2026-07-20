import type { ContextWindowUsageSnapshot, ProviderUsage } from "../shared/types"
import { computeCostUsd } from "../shared/token-pricing"
import type { ModelPrice } from "../shared/token-pricing"
import type { HarnessEvent } from "./harness-types"
import {
  timestamped,
  type ClaudeRawSdkMessage,
  getClaudeAssistantMessageUsageId,
  normalizeClaudeStreamMessage,
} from "./claude-message-normalizer"
import {
  normalizeClaudeUsageSnapshot,
  resolveFinalTurnUsage,
  maxClaudeContextWindowFromModelUsage,
} from "./claude-usage-math"
import { ClaudeLimitDetector } from "./auto-continue/limit-detector"

export async function* createClaudeHarnessStream(
  q: AsyncIterable<ClaudeRawSdkMessage>,
  configuredContextWindow?: number,
  resolveTurnPrice?: () => ModelPrice | null,
): AsyncGenerator<HarnessEvent> {
  let seenAssistantUsageIds = new Set<string>()
  let latestUsageSnapshot: ContextWindowUsageSnapshot | null = null
  let lastKnownContextWindow: number | undefined = configuredContextWindow
  const detector = new ClaudeLimitDetector()
  // SDK rate-limit / api-error turns emit BOTH a synthetic assistant
  // `isApiErrorMessage` (→ `api_error` entry, red card with text) AND a
  // `type:"result"` whose `result` field repeats the same text (→ second
  // red card + "Failed after Xs"). Track per-turn api_error emission so
  // we can scrub the duplicate body off the trailing result entry; the
  // duration footer still renders, the message renders once.
  let apiErrorEmittedInTurn = false

  // Per-turn billed token usage and cost to attach to the result entry.
  // Set when the `type:"result"` SDK message is processed; cleared after
  // the result entry is yielded so they don't leak to a subsequent turn.
  let pendingResultUsage: ProviderUsage | undefined
  let pendingResultCost: number | undefined

  for await (const sdkMessage of q) {
    const sessionToken = typeof sdkMessage.session_id === "string" ? sdkMessage.session_id : null
    if (sessionToken) {
      yield { type: "session_token", sessionToken }
    }

    if (sdkMessage?.type === "rate_limit_event") {
      const detection = detector.detectFromSdkRateLimitInfo("", sdkMessage.rate_limit_info)
      if (detection) {
        yield { type: "rate_limit", rateLimit: { resetAt: detection.resetAt, tz: detection.tz } }
      }
    }

    if (sdkMessage?.type === "assistant") {
      const usageId = getClaudeAssistantMessageUsageId(sdkMessage)
      const usageSnapshot = normalizeClaudeUsageSnapshot(sdkMessage.usage, lastKnownContextWindow)
      if (usageId && usageSnapshot && !seenAssistantUsageIds.has(usageId)) {
        seenAssistantUsageIds.add(usageId)
        latestUsageSnapshot = usageSnapshot
        yield {
          type: "transcript",
          entry: timestamped({
            kind: "context_window_updated",
            usage: usageSnapshot,
          }),
        }
      }
    }

    if (sdkMessage?.type === "result") {
      const resultContextWindow = maxClaudeContextWindowFromModelUsage(sdkMessage.modelUsage)
      // Never let SDK lower the configured window — see comment on
      // parseConfiguredContextWindowFromModelId for the 1M beta footgun.
      if (resultContextWindow !== undefined) {
        lastKnownContextWindow = Math.max(lastKnownContextWindow ?? 0, resultContextWindow)
      }

      const accumulatedUsage = normalizeClaudeUsageSnapshot(
        sdkMessage.usage,
        lastKnownContextWindow,
      )
      const finalUsage = resolveFinalTurnUsage(
        latestUsageSnapshot,
        accumulatedUsage,
        lastKnownContextWindow,
      )

      const providerCostUsd =
        typeof sdkMessage.total_cost_usd === "number"
          ? sdkMessage.total_cost_usd
          : undefined

      let costUsd = providerCostUsd
      if (costUsd === undefined && resolveTurnPrice && finalUsage) {
        const price = resolveTurnPrice()
        if (price) {
          costUsd = computeCostUsd(
            {
              inputTokens: finalUsage.inputTokens,
              cachedInputTokens: finalUsage.cachedInputTokens,
              outputTokens: finalUsage.outputTokens,
            },
            price,
          )
        }
      }

      // Stash billed token figures for the result entry (populated below
      // in the entry loop). Prefer `accumulatedUsage` (the per-turn
      // cumulative that the SDK computes) for tokens; fall back to
      // `finalUsage` when accumulated is null.
      const billed = accumulatedUsage ?? finalUsage
      pendingResultUsage = billed
        ? {
            ...(billed.inputTokens !== undefined ? { inputTokens: billed.inputTokens } : {}),
            ...(billed.outputTokens !== undefined ? { outputTokens: billed.outputTokens } : {}),
            ...(billed.cachedInputTokens !== undefined ? { cachedInputTokens: billed.cachedInputTokens } : {}),
          }
        : undefined
      pendingResultCost = costUsd

      if (finalUsage) {
        const usageWithCost = costUsd !== undefined ? { ...finalUsage, costUsd } : finalUsage
        yield {
          type: "transcript",
          entry: timestamped({
            kind: "context_window_updated",
            usage: usageWithCost,
          }),
        }
      }

      seenAssistantUsageIds = new Set<string>()
      latestUsageSnapshot = null
    }

    for (const entry of normalizeClaudeStreamMessage(sdkMessage)) {
      if (entry.kind === "api_error") {
        apiErrorEmittedInTurn = true
      } else if (entry.kind === "result") {
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
        yield { type: "transcript", entry: enriched }
        continue
      }
      yield { type: "transcript", entry }
    }
  }
}
