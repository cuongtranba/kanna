import { useMemo } from "react"
import { withCustomProviders } from "../../shared/custom-providers"
import { mergeCustomModels, PROVIDERS, type ProviderCatalogEntry } from "../../shared/types"
import { selectCustomModels, selectCustomProviders, useAppSettingsStore } from "../stores/appSettingsStore"

export function useProviderCatalog(): ProviderCatalogEntry[] {
  const customModels = useAppSettingsStore(selectCustomModels)
  const customProviders = useAppSettingsStore(selectCustomProviders)
  return useMemo(
    () => withCustomProviders(mergeCustomModels([...PROVIDERS], customModels), customProviders),
    [customModels, customProviders],
  )
}
