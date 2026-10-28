import type { ContextWindowUsageSnapshot, ProviderUsage } from "../shared/types"
import { computeCostUsd } from "../shared/token-pricing"
import type { ModelPrice } from "../shared/token-pricing"
import type { HarnessEvent } from "./harness-types"
import { timestamped } from "../shared/transcript-entry"
import {
  type ClaudeRawSdkMessage,
  getClaudeAssistantMessageUsageId,
  normalizeClaudeStreamMessage,
} from "./claude-message-normalizer"
import {
  normalizeClaudeUsageSnapshot,
  resolveFinalTurnUsage,
  maxClaudeContextWindowFromModelUsage,
  modelUsageHasUnpricedModel,
} from "./claude-usage-math"
import { ClaudeLimitDetector } from "./auto-continue/limit-detector"
import { createLiveBlockAccumulator } from "./claude-live-block"

function turnCostFromRunningTotal(runningTotalUsd: number, previousTotalUsd: number): number {
  return runningTotalUsd >= previousTotalUsd ? runningTotalUsd - previousTotalUsd : runningTotalUsd
}

export interface HarnessStreamOptions {
  contextWindow?: number
  turnPrice?: ModelPrice | null
  costBaselineUsd?: number
}

interface ResultAccounting {
  usage: ProviderUsage | undefined
  costUsd: number | undefined
  cumulativeCostUsd: number | undefined
}

interface ResultAccountingInput {
  message: ClaudeRawSdkMessage
  latestUsageSnapshot: ContextWindowUsageSnapshot | null
  contextWindow: number | undefined
  previousCumulativeCostUsd: number
  turnPrice: ModelPrice | null | undefined
}

function accountForResult(input: ResultAccountingInput): {
  contextWindow: number | undefined
  contextUsage: ContextWindowUsageSnapshot | null
  accounting: ResultAccounting
} {
  const { message, latestUsageSnapshot, previousCumulativeCostUsd, turnPrice } = input
  const resultContextWindow = maxClaudeContextWindowFromModelUsage(message.modelUsage)
  const contextWindow = resultContextWindow === undefined
    ? input.contextWindow
    : Math.max(input.contextWindow ?? 0, resultContextWindow)

  const accumulatedUsage = normalizeClaudeUsageSnapshot(message.usage, contextWindow)
  const finalUsage = resolveFinalTurnUsage(latestUsageSnapshot, accumulatedUsage, contextWindow)

  const cumulativeCostUsd = typeof message.total_cost_usd === "number" ? message.total_cost_usd : undefined

  let costUsd = cumulativeCostUsd === undefined || modelUsageHasUnpricedModel(message.modelUsage)
    ? undefined
    : turnCostFromRunningTotal(cumulativeCostUsd, previousCumulativeCostUsd)
  if (costUsd === undefined && turnPrice && finalUsage) {
    costUsd = computeCostUsd(
      {
        inputTokens: finalUsage.inputTokens,
        cachedInputTokens: finalUsage.cachedInputTokens,
        outputTokens: finalUsage.outputTokens,
      },
      turnPrice,
    )
  }

  const billed = accumulatedUsage ?? finalUsage
  const usage = billed
    ? {
        ...(billed.inputTokens !== undefined ? { inputTokens: billed.inputTokens } : {}),
        ...(billed.outputTokens !== undefined ? { outputTokens: billed.outputTokens } : {}),
        ...(billed.cachedInputTokens !== undefined ? { cachedInputTokens: billed.cachedInputTokens } : {}),
      }
    : undefined

  const contextUsage = finalUsage && costUsd !== undefined ? { ...finalUsage, costUsd } : finalUsage
  return { contextWindow, contextUsage, accounting: { usage, costUsd, cumulativeCostUsd } }
}

export async function* createClaudeHarnessStream(
  q: AsyncIterable<ClaudeRawSdkMessage>,
  options: HarnessStreamOptions = {},
): AsyncGenerator<HarnessEvent> {
  let lastCumulativeCostUsd = options.costBaselineUsd ?? 0
  let seenAssistantUsageIds = new Set<string>()
  let latestUsageSnapshot: ContextWindowUsageSnapshot | null = null
  let lastKnownContextWindow: number | undefined = options.contextWindow
  const detector = new ClaudeLimitDetector()
  let apiErrorEmittedInTurn = false

  let unreportedResult: ResultAccounting | null = null
  const accumulateLiveBlock = createLiveBlockAccumulator()

  for await (const sdkMessage of q) {
    if (sdkMessage?.type === "stream_event") {
      if (sdkMessage.parent_tool_use_id == null) {
        const block = accumulateLiveBlock(sdkMessage.event)
        if (block) yield { type: "live", block }
      }
      continue
    }

    if (sdkMessage?.type === "system" && sdkMessage.subtype === "thinking_tokens") continue

    const sessionToken = typeof sdkMessage.session_id === "string" ? sdkMessage.session_id : null
    if (sessionToken) {
      yield { type: "session_token", sessionToken }
    }

    if (sdkMessage?.type === "rate_limit_event") {
      const detection = detector.detectFromSdkRateLimitInfo("", sdkMessage.rate_limit_info ?? null)
      if (detection) {
        yield { type: "rate_limit", rateLimit: { resetAt: detection.resetAt, tz: detection.tz } }
      }
    }

    if (sdkMessage?.type === "assistant") {
      const usageId = getClaudeAssistantMessageUsageId(sdkMessage)
      const usageSnapshot = normalizeClaudeUsageSnapshot(
        sdkMessage.message?.usage ?? sdkMessage.usage,
        lastKnownContextWindow,
      )
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
      const { contextWindow, contextUsage, accounting } = accountForResult({
        message: sdkMessage,
        latestUsageSnapshot,
        contextWindow: lastKnownContextWindow,
        previousCumulativeCostUsd: lastCumulativeCostUsd,
        turnPrice: options.turnPrice,
      })
      lastKnownContextWindow = contextWindow
      unreportedResult = accounting

      if (contextUsage) {
        yield {
          type: "transcript",
          entry: timestamped({
            kind: "context_window_updated",
            usage: contextUsage,
          }),
        }
      }

      seenAssistantUsageIds = new Set<string>()
      latestUsageSnapshot = null
    }

    for (const entry of normalizeClaudeStreamMessage(sdkMessage)) {
      if (entry.kind === "api_error") {
        apiErrorEmittedInTurn = true
      } else if (entry.kind === "context_cleared") {
        lastCumulativeCostUsd = 0
      } else if (entry.kind === "result") {
        const scrubbed = entry.isError && apiErrorEmittedInTurn
          ? { ...entry, result: "" }
          : entry
        apiErrorEmittedInTurn = false
        const enriched = {
          ...scrubbed,
          ...(unreportedResult?.usage !== undefined ? { usage: unreportedResult.usage } : {}),
          ...(unreportedResult?.costUsd !== undefined ? { costUsd: unreportedResult.costUsd } : {}),
          ...(unreportedResult?.cumulativeCostUsd !== undefined ? { cumulativeCostUsd: unreportedResult.cumulativeCostUsd } : {}),
        }
        if (unreportedResult?.cumulativeCostUsd !== undefined) lastCumulativeCostUsd = unreportedResult.cumulativeCostUsd
        unreportedResult = null
        yield { type: "transcript", entry: enriched }
        continue
      }
      yield { type: "transcript", entry }
    }
  }
}
