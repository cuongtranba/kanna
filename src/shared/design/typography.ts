// Pure font-scale core (per docs/tribe/planning/typography-scale-preference-spec.md §2.1).
// Everything here is pure: no DOM, no storage, no clock, no store reads. All inputs arrive
// as arguments (~/.claude/rules/pure-core.md). `JsonValue` (an alias for `unknown`, see
// src/shared/errors.ts) is used instead of the banned bare `unknown` keyword to accept
// literally arbitrary/untrusted input while staying total.

import type { JsonValue } from "../json"

export type FontScaleStep = "sm" | "md" | "lg" | "xl" | "xxl"

export const FONT_SCALE_STEPS: readonly FontScaleStep[] = ["sm", "md", "lg", "xl", "xxl"]

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

/**
 * Type guard: is `value` one of the five documented font-scale steps?
 *
 * Generic over the input so it composes with the `isPlainObject<T>` idiom the
 * settings normalizers use, as well as with a plain `JsonValue` off disk.
 */
export function isFontScaleStep<T>(value: T): value is T & FontScaleStep {
  return typeof value === "string" && Object.hasOwn(FONT_SCALE_MULTIPLIERS, value)
}

/** Total function: any unknown/garbage/out-of-range input resolves to 1 (md). */
export function resolveFontScale(step: JsonValue | undefined): number {
  // Narrow to `string` first: `JsonValue & FontScaleStep` is an intersection TS
  // will not reduce, so it cannot index the multiplier map, while
  // `string & FontScaleStep` reduces to the union and can.
  if (typeof step !== "string" || !isFontScaleStep(step)) {
    return FONT_SCALE_MULTIPLIERS[DEFAULT_FONT_SCALE_STEP]
  }
  return FONT_SCALE_MULTIPLIERS[step]
}

/**
 * PURE precedence: deviceOverride ?? serverDefault ?? "md". Reads no store — both
 * values must arrive as arguments. Garbage input at either position is treated as
 * absent, not as a valid override/default.
 */
export function resolveEffectiveScaleStep(deviceOverride: JsonValue | undefined, serverDefault: JsonValue | undefined): FontScaleStep {
  if (isFontScaleStep(deviceOverride)) return deviceOverride
  if (isFontScaleStep(serverDefault)) return serverDefault
  return DEFAULT_FONT_SCALE_STEP
}

/**
 * Emits a MAP of CSS custom properties — never a single hardcoded write. Adding a
 * font-family key later is ONE new entry in this map, with zero change to the
 * applier, the DomPort, or the persistence plumbing.
 */
export function resolveTypographyVars(pref: TypographyPreference | undefined): Record<string, string> {
  const step = pref && isFontScaleStep(pref.scale) ? pref.scale : DEFAULT_FONT_SCALE_STEP
  return {
    "--kanna-font-scale": String(FONT_SCALE_MULTIPLIERS[step]),
  }
}
