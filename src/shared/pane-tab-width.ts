/**
 * How narrow a pane tab may get, as one fact both layers agree on.
 *
 * The tab strip needs these to lay tabs out; app-settings needs them to clamp
 * the user's preference. Holding them here rather than in each layer is what
 * stops the settings range and the layout floor from drifting apart — the way
 * the terminal's min-column-width bounds already have.
 */

/** Icon (14) + horizontal padding (24) + close button (22). */
export const MIN_TAB_WIDTH = 60
export const MAX_TAB_WIDTH = 200

/**
 * Shrink all the way to the icon-only floor, which is what the strip did before
 * the preference existed — so an upgrade changes nobody's layout.
 */
export const DEFAULT_TAB_MIN_WIDTH = MIN_TAB_WIDTH

/**
 * Generic in the same shape as app-settings' own `clampNumber`: the settings
 * file is hand-editable, so the value arriving here is only claimed to be a
 * number, never known to be one.
 */
export function clampTabMinWidth<T>(value: T): number {
  const width = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(width)) return DEFAULT_TAB_MIN_WIDTH
  return Math.min(MAX_TAB_WIDTH, Math.max(MIN_TAB_WIDTH, Math.round(width)))
}
