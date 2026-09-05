import { DEFAULT_FONT_SCALE_STEP, FONT_SCALE_STEPS, isFontScaleStep, type FontScaleStep } from "../design/typography"
import { isPlainObject } from "./plain-object"

export interface TypographySettings {
  scale: FontScaleStep
}

export const TYPOGRAPHY_DEFAULTS: TypographySettings = {
  scale: DEFAULT_FONT_SCALE_STEP,
}

export function normalizeTypographySettings<T>(value: T, warnings: string[]): TypographySettings {
  const source = isPlainObject(value) ? value : null
  if (value !== undefined && !source) {
    warnings.push("typography must be an object")
  }

  const rawScale = source?.scale
  if (rawScale === undefined) return { ...TYPOGRAPHY_DEFAULTS }

  if (!isFontScaleStep(rawScale)) {
    warnings.push(`typography.scale must be one of: ${FONT_SCALE_STEPS.join(", ")}`)
    return { ...TYPOGRAPHY_DEFAULTS }
  }

  return { scale: rawScale }
}
