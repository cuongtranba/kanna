export const DEFAULT_TERMINAL_SCROLLBACK = 1_000
export const MIN_TERMINAL_SCROLLBACK = 500
export const MAX_TERMINAL_SCROLLBACK = 5_000

export function clampScrollback(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TERMINAL_SCROLLBACK
  return Math.min(MAX_TERMINAL_SCROLLBACK, Math.max(MIN_TERMINAL_SCROLLBACK, Math.round(value)))
}
