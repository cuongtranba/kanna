import type { ProviderUsage } from "./types"

export interface ModelPrice {
  inputPerMTok: number
  outputPerMTok: number
  cachedInputPerMTok?: number
}

export interface OpenRouterPricing {
  promptPerTok: number
  completionPerTok: number
}

const MILLION = 1_000_000

export function computeCostUsd(usage: ProviderUsage, price: ModelPrice): number {
  const input = nonNeg(usage.inputTokens)
  const cached = nonNeg(usage.cachedInputTokens)
  const output = nonNeg(usage.outputTokens)
  const nonCachedInput = Math.max(0, input - cached)
  const cachedRate = price.cachedInputPerMTok ?? price.inputPerMTok
  return (
    (nonCachedInput / MILLION) * price.inputPerMTok
    + (cached / MILLION) * cachedRate
    + (output / MILLION) * price.outputPerMTok
  )
}

export function billedUsageOfResult(
  entry: { usage?: ProviderUsage; costUsd?: number },
): ProviderUsage | undefined {
  const costUsd = entry.costUsd ?? entry.usage?.costUsd
  if (!entry.usage && costUsd === undefined) return undefined
  return { ...entry.usage, ...(costUsd !== undefined ? { costUsd } : {}) }
}

export type BilledTokenKind = "input" | "cached_input" | "output"

export function splitBilledTokens(
  usage: ProviderUsage,
): ReadonlyArray<readonly [BilledTokenKind, number]> {
  const cached = nonNeg(usage.cachedInputTokens)
  const counts: ReadonlyArray<readonly [BilledTokenKind, number]> = [
    ["input", Math.max(0, nonNeg(usage.inputTokens) - cached)],
    ["cached_input", cached],
    ["output", nonNeg(usage.outputTokens)],
  ]
  return counts.filter(([, count]) => count > 0)
}

const STATIC_PRICES: ReadonlyArray<readonly [string, ModelPrice]> = [
  ["opus", { inputPerMTok: 15, outputPerMTok: 75, cachedInputPerMTok: 1.5 }],
  ["sonnet", { inputPerMTok: 3, outputPerMTok: 15, cachedInputPerMTok: 0.3 }],
  ["haiku", { inputPerMTok: 0.8, outputPerMTok: 4, cachedInputPerMTok: 0.08 }],
  ["gpt-5", { inputPerMTok: 1.25, outputPerMTok: 10 }],
  ["o4", { inputPerMTok: 1.1, outputPerMTok: 4.4 }],
]

function matchesNeedle(id: string, needle: string): boolean {
  if (needle === "opus" || needle === "sonnet" || needle === "haiku") {
    return id.includes(needle)
  }
  return new RegExp(`(^|[^a-z0-9])${needle}([^a-z0-9]|$)`).test(id)
}

export function stripModelVariantSuffix(modelId: string): string {
  const i = modelId.indexOf(":")
  return i === -1 ? modelId : modelId.slice(0, i)
}

export function resolveModelPrice(
  modelId: string,
  openRouterPricing?: OpenRouterPricing | null,
): ModelPrice | null {
  if (openRouterPricing) {
    const inputPerMTok = openRouterPricing.promptPerTok * MILLION
    const outputPerMTok = openRouterPricing.completionPerTok * MILLION
    if (Number.isFinite(inputPerMTok) && Number.isFinite(outputPerMTok)) {
      return { inputPerMTok, outputPerMTok }
    }
  }
  const id = modelId.toLowerCase()
  for (const [needle, price] of STATIC_PRICES) {
    if (matchesNeedle(id, needle)) return price
  }
  return null
}

function nonNeg(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0
}
