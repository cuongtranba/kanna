import type { ProviderUsage } from "./types"

/** USD per 1,000,000 tokens. */
export interface ModelPrice {
  inputPerMTok: number
  outputPerMTok: number
  cachedInputPerMTok?: number
}

/** Per-token pricing as returned by the OpenRouter model list. */
export interface OpenRouterPricing {
  promptPerTok: number
  completionPerTok: number
}

const MILLION = 1_000_000

export function computeCostUsd(usage: ProviderUsage, price: ModelPrice): number {
  const input = nonNeg(usage.inputTokens)
  const cached = nonNeg(usage.cachedInputTokens)
  const output = nonNeg(usage.outputTokens)
  const cachedRate = price.cachedInputPerMTok ?? price.inputPerMTok
  return (
    (input / MILLION) * price.inputPerMTok
    + (cached / MILLION) * cachedRate
    + (output / MILLION) * price.outputPerMTok
  )
}

const STATIC_PRICES: ReadonlyArray<readonly [string, ModelPrice]> = [
  ["opus", { inputPerMTok: 15, outputPerMTok: 75, cachedInputPerMTok: 1.5 }],
  ["sonnet", { inputPerMTok: 3, outputPerMTok: 15, cachedInputPerMTok: 0.3 }],
  ["haiku", { inputPerMTok: 0.8, outputPerMTok: 4, cachedInputPerMTok: 0.08 }],
  ["gpt-5", { inputPerMTok: 1.25, outputPerMTok: 10 }],
  ["o4", { inputPerMTok: 1.1, outputPerMTok: 4.4 }],
]

export function resolveModelPrice(
  modelId: string,
  openRouterPricing?: OpenRouterPricing | null,
): ModelPrice | null {
  if (openRouterPricing) {
    const inputPerMTok = openRouterPricing.promptPerTok * MILLION
    const outputPerMTok = openRouterPricing.completionPerTok * MILLION
    if (inputPerMTok > 0 || outputPerMTok > 0) {
      return { inputPerMTok, outputPerMTok }
    }
  }
  const id = modelId.toLowerCase()
  for (const [needle, price] of STATIC_PRICES) {
    if (id.includes(needle)) return price
  }
  return null
}

function nonNeg(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0
}
