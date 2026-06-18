import { OPENROUTER_MODELS_URL } from "../shared/types"

export async function fetchOpenRouterModelsRaw(): Promise<unknown> {
  const res = await fetch(OPENROUTER_MODELS_URL, { headers: { accept: "application/json" } })
  if (!res.ok) throw new Error(`OpenRouter models fetch failed: ${res.status}`)
  return res.json()
}
