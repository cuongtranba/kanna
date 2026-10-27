import { clampRounded } from "./numeric"

export const DEFAULT_TERMINAL_MIN_COLUMN_WIDTH = 450
export const MIN_TERMINAL_MIN_COLUMN_WIDTH = 250
export const MAX_TERMINAL_MIN_COLUMN_WIDTH = 900

export function clampTerminalMinColumnWidth<T>(value: T): number {
  return clampRounded(
    value,
    { min: MIN_TERMINAL_MIN_COLUMN_WIDTH, max: MAX_TERMINAL_MIN_COLUMN_WIDTH },
    DEFAULT_TERMINAL_MIN_COLUMN_WIDTH,
  )
}
