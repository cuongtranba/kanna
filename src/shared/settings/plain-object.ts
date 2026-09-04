/**
 * Re-exported rather than redeclared: this was a byte-for-byte duplicate of
 * `isRecord` (`Boolean(value)` and `value !== null` agree on every object), and
 * keeping the second copy would have meant exempting a third file from the
 * unknown ban to say what the chokepoint already says.
 */
export { isRecord as isPlainObject } from "../errors"

export function clampToRange(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}
