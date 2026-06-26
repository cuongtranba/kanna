import type { OpenRouterModel } from "../shared/types"

interface RawModelPricing {
  prompt?: unknown
  completion?: unknown
}

interface RawModel {
  id?: unknown
  name?: unknown
  context_length?: unknown
  supported_parameters?: unknown
  pricing?: RawModelPricing
}

function parsePricing(
  pricing: RawModelPricing | undefined,
): { promptPerTok: number; completionPerTok: number } | undefined {
  if (pricing === undefined) return undefined
  if (pricing.prompt === "" || pricing.completion === "") return undefined
  const prompt = Number(pricing.prompt)
  const completion = Number(pricing.completion)
  if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return undefined
  if (prompt < 0 || completion < 0) return undefined
  return { promptPerTok: prompt, completionPerTok: completion }
}

export function parseOpenRouterModels(raw: unknown): OpenRouterModel[] {
  const data = (raw as { data?: unknown })?.data
  if (!Array.isArray(data)) return []
  const out: OpenRouterModel[] = []
  for (const entry of data as RawModel[]) {
    if (typeof entry?.id !== "string") continue
    const params = Array.isArray(entry.supported_parameters) ? entry.supported_parameters : []
    if (!params.includes("tools")) continue
    const pricing = parsePricing(entry.pricing)
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
