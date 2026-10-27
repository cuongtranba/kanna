import { DEFAULT_FONT_SCALE_STEP, FONT_SCALE_STEPS, type FontScaleStep } from "../design/typography"
import { readSettingsSection } from "./read-fields"

export interface TypographySettings {
  scale: FontScaleStep
}

export const TYPOGRAPHY_DEFAULTS: TypographySettings = {
  scale: DEFAULT_FONT_SCALE_STEP,
}

export function normalizeTypographySettings<T>(value: T, warnings: string[]): TypographySettings {
  const section = readSettingsSection(value, "typography", warnings)
  return {
    scale: section.member(
      "scale",
      FONT_SCALE_STEPS,
      TYPOGRAPHY_DEFAULTS.scale,
      `one of: ${FONT_SCALE_STEPS.join(", ")}`,
    ),
  }
}
