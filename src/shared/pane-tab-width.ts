import { clampRounded } from "./numeric"

export const MIN_TAB_WIDTH = 60
export const MAX_TAB_WIDTH = 200

export const DEFAULT_TAB_MIN_WIDTH = MIN_TAB_WIDTH

export function clampTabMinWidth<T>(value: T): number {
  return clampRounded(value, { min: MIN_TAB_WIDTH, max: MAX_TAB_WIDTH }, DEFAULT_TAB_MIN_WIDTH)
}
