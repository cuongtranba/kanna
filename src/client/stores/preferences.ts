import { create } from "zustand"
import { persist } from "zustand/middleware"
import { isFontScaleStep, type FontScaleStep } from "../../shared/design/typography"
import { isJsonObject, type JsonObject, type JsonValue } from "../../shared/json"
import { asJsonValue } from "../lib/asJsonValue"

interface PreferencesState {
  autoResumeOnRateLimit: boolean
  setAutoResumeOnRateLimit: (value: boolean) => void
  typographyOverride?: FontScaleStep
  typographyServerDefaultCache?: FontScaleStep
  setTypographyOverride: (step: FontScaleStep) => void
  clearTypographyOverride: () => void
  cacheTypographyServerDefault: (step: FontScaleStep) => void
}

export function migratePreferencesState(
  persistedState: JsonValue,
): Pick<PreferencesState, "autoResumeOnRateLimit" | "typographyOverride" | "typographyServerDefaultCache"> {
  const persisted: JsonObject | null = isJsonObject(persistedState) ? persistedState : null
  const typographyOverride = stepOrUndefined(persisted?.typographyOverride)
  const typographyServerDefaultCache = stepOrUndefined(persisted?.typographyServerDefaultCache)
  return {
    autoResumeOnRateLimit: Boolean(persisted?.autoResumeOnRateLimit),
    typographyOverride,
    typographyServerDefaultCache,
  }
}

function stepOrUndefined(value: JsonValue | undefined): FontScaleStep | undefined {
  if (typeof value !== "string") return undefined
  return isFontScaleStep(value) ? value : undefined
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      autoResumeOnRateLimit: false,
      setAutoResumeOnRateLimit: (value) => set({ autoResumeOnRateLimit: value }),
      typographyOverride: undefined,
      typographyServerDefaultCache: undefined,
      setTypographyOverride: (step) => set({ typographyOverride: step }),
      clearTypographyOverride: () => set({ typographyOverride: undefined }),
      cacheTypographyServerDefault: (step) => set({ typographyServerDefaultCache: step }),
    }),
    {
      name: "kanna-preferences",
      version: 2,
      migrate: (persistedState) => migratePreferencesState(asJsonValue(persistedState)),
    },
  ),
)
