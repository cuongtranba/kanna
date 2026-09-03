import type { StatusTone } from "./statusLabel"

/**
 * State is carried in the mark's FORM, not in hue.
 *
 * A dot that changes colour is unreadable in greyscale, at a glance from across
 * the desk, and to a reader with reduced colour vision — the three ways this UI
 * is actually read during a long session. Each tone therefore owns a mark with
 * its own silhouette, and colour is free to agree without ever deciding.
 */
export type StateMarkKind = "doubled" | "based" | "struck" | "half"

export function stateMarkKind(tone: StatusTone): StateMarkKind {
  switch (tone) {
    case "active": return "doubled"
    case "destructive": return "struck"
    case "attention": return "half"
    case "muted":
    default: return "based"
  }
}

export interface MarkStroke {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

/**
 * Geometry for the 9x13 mark, as exact strokes rather than a drawing.
 *
 * Kept as data so the shapes are testable and identical everywhere they render;
 * a component that hand-rolls its own path is a mark that will drift.
 */
export function stateMarkStrokes(kind: StateMarkKind): readonly MarkStroke[] {
  switch (kind) {
    case "doubled":
      return [
        { x1: 2.5, y1: 1, x2: 2.5, y2: 12 },
        { x1: 6.5, y1: 1, x2: 6.5, y2: 12 },
      ]
    case "based":
      return [
        { x1: 4.5, y1: 1, x2: 4.5, y2: 10 },
        { x1: 1, y1: 11.5, x2: 8, y2: 11.5 },
      ]
    case "struck":
      return [
        { x1: 4.5, y1: 1, x2: 4.5, y2: 12 },
        { x1: 0.5, y1: 9.5, x2: 8.5, y2: 3.5 },
      ]
    case "half":
      return [{ x1: 4.5, y1: 5, x2: 4.5, y2: 12 }]
  }
}
