import type { StatusTone } from "./statusLabel"

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
