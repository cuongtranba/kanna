import { create } from "zustand"
import { persist } from "zustand/middleware"
import { isFontScaleStep, type FontScaleStep } from "../../shared/design/typography"

interface PreferencesState {
  autoResumeOnRateLimit: boolean
  setAutoResumeOnRateLimit: (value: boolean) => void
  /** Device-local font-scale override; undefined means "no override, defer to server default". */
  typographyOverride?: FontScaleStep
  /** Last-seen server-provided font-scale default, cached for pre-paint reads. */
  typographyServerDefaultCache?: FontScaleStep
  setTypographyOverride: (step: FontScaleStep) => void
  clearTypographyOverride: () => void
  cacheTypographyServerDefault: (step: FontScaleStep) => void
}

interface PersistedPreferencesState {
  autoResumeOnRateLimit?: boolean
  typographyOverride?: FontScaleStep
  typographyServerDefaultCache?: FontScaleStep
}

export function migratePreferencesState(
  persistedState: Partial<PersistedPreferencesState> | undefined,
): Pick<PreferencesState, "autoResumeOnRateLimit" | "typographyOverride" | "typographyServerDefaultCache"> {
  return {
    autoResumeOnRateLimit: Boolean(persistedState?.autoResumeOnRateLimit),
    typographyOverride: isFontScaleStep(persistedState?.typographyOverride)
      ? persistedState.typographyOverride
      : undefined,
    typographyServerDefaultCache: isFontScaleStep(persistedState?.typographyServerDefaultCache)
      ? persistedState.typographyServerDefaultCache
      : undefined,
  }
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
      migrate: (persistedState) => migratePreferencesState(
        <Partial<PersistedPreferencesState> | undefined>persistedState,
      ),
    },
  ),
)
