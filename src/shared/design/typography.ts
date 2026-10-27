
import type { JsonValue } from "../json"
import { oneOf } from "../vocab"

export const FONT_SCALE_STEPS = ["sm", "md", "lg", "xl", "xxl"] as const

export type FontScaleStep = (typeof FONT_SCALE_STEPS)[number]

export const FONT_SCALE_MULTIPLIERS: Record<FontScaleStep, number> = {
  sm: 0.875,
  md: 1,
  lg: 1.125,
  xl: 1.25,
  xxl: 1.5,
}

export const DEFAULT_FONT_SCALE_STEP: FontScaleStep = "md"

export interface TypographyPreference {
  scale: FontScaleStep
}

export const isFontScaleStep = oneOf(FONT_SCALE_STEPS)

export function resolveFontScale(step: JsonValue | undefined): number {
  if (typeof step !== "string" || !isFontScaleStep(step)) {
    return FONT_SCALE_MULTIPLIERS[DEFAULT_FONT_SCALE_STEP]
  }
  return FONT_SCALE_MULTIPLIERS[step]
}

export function resolveEffectiveScaleStep(deviceOverride: JsonValue | undefined, serverDefault: JsonValue | undefined): FontScaleStep {
  if (isFontScaleStep(deviceOverride)) return deviceOverride
  if (isFontScaleStep(serverDefault)) return serverDefault
  return DEFAULT_FONT_SCALE_STEP
}

export function resolveTypographyVars(pref: TypographyPreference | undefined): Record<string, string> {
  const step = pref && isFontScaleStep(pref.scale) ? pref.scale : DEFAULT_FONT_SCALE_STEP
  return {
    "--kanna-font-scale": String(FONT_SCALE_MULTIPLIERS[step]),
  }
}
