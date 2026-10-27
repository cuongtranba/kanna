import { clampRounded } from "./numeric"

export const DEFAULT_TERMINAL_SCROLLBACK = 1_000
export const MIN_TERMINAL_SCROLLBACK = 500
export const MAX_TERMINAL_SCROLLBACK = 5_000

export function clampScrollback<T>(value: T): number {
  return clampRounded(value, { min: MIN_TERMINAL_SCROLLBACK, max: MAX_TERMINAL_SCROLLBACK }, DEFAULT_TERMINAL_SCROLLBACK)
}
