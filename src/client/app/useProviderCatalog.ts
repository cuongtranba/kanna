import { useMemo } from "react"
import { withCustomProviders } from "../../shared/custom-providers"
import { mergeCustomModels, PROVIDERS, type OpenRouterModel, type ProviderCatalogEntry } from "../../shared/types"
import { selectCustomModels, selectCustomProviders, useAppSettingsStore } from "../stores/appSettingsStore"

export function useProviderCatalog(): ProviderCatalogEntry[] {
  const customModels = useAppSettingsStore(selectCustomModels)
  const customProviders = useAppSettingsStore(selectCustomProviders)
  return useMemo(
    () => withCustomProviders(mergeCustomModels([...PROVIDERS], customModels), customProviders),
    [customModels, customProviders],
  )
}

export function withOpenRouterModels(
  providers: ProviderCatalogEntry[],
  models: OpenRouterModel[],
): ProviderCatalogEntry[] {
  if (models.length === 0) return providers
  return providers.map((entry) => {
    if (entry.id !== "openrouter") return entry
    return {
      ...entry,
      models: models.map((m) => ({
        id: m.id,
        label: m.label,
      })),
    }
  })
}
