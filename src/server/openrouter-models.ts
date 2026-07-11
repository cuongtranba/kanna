import type { OpenRouterModel } from "../shared/types"
import type { AnyValue } from "../shared/errors"

interface RawModelPricing {
  prompt?: AnyValue
  completion?: AnyValue
}

function toRate(value: AnyValue): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null
  }
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (trimmed === "") return null
    const n = Number(trimmed)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  return null
}

function parsePricing(
  pricing: RawModelPricing | undefined,
): { promptPerTok: number; completionPerTok: number } | undefined {
  if (pricing === undefined) return undefined
  const prompt = toRate(pricing.prompt)
  const completion = toRate(pricing.completion)
  if (prompt === null || completion === null) return undefined
  return { promptPerTok: prompt, completionPerTok: completion }
}

import { isRecord } from "../shared/errors"

export function parseOpenRouterModels(raw: AnyValue): OpenRouterModel[] {
  if (!isRecord(raw)) return []
  const { data } = raw
  if (!Array.isArray(data)) return []
  const out: OpenRouterModel[] = []
  for (const entry of data) {
    if (!isRecord(entry)) continue
    if (typeof entry.id !== "string") continue
    const params = Array.isArray(entry.supported_parameters) ? entry.supported_parameters : []
    if (!params.includes("tools")) continue
    const pricing = parsePricing(isRecord(entry.pricing) ? { prompt: entry.pricing.prompt, completion: entry.pricing.completion } : undefined)
    out.push({
      id: entry.id,
      label: typeof entry.name === "string" && entry.name.length > 0 ? entry.name : entry.id,
      contextLength: typeof entry.context_length === "number" ? entry.context_length : 0,
      ...(pricing ? { pricing } : {}),
    })
  }
  return out
}

export interface OpenRouterModelCacheDeps {
  fetchRaw: () => Promise<unknown>
  ttlMs: number
  now: () => number
}

export class OpenRouterModelCache {
  private cached: OpenRouterModel[] | null = null
  private fetchedAt = 0
  constructor(private readonly deps: OpenRouterModelCacheDeps) {}

  async list(): Promise<OpenRouterModel[]> {
    const cached = this.cached
    const fresh = cached !== null && this.deps.now() - this.fetchedAt < this.deps.ttlMs
    if (fresh) return cached
    try {
      const models = parseOpenRouterModels(await this.deps.fetchRaw())
      this.cached = models
      this.fetchedAt = this.deps.now()
      return models
    } catch (error) {
      if (this.cached !== null) return this.cached
      throw error
    }
  }
}
