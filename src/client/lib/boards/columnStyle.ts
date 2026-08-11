/**
 * Small pure helpers the board renders with.
 *
 * This file used to project Kanna's snapshot into `react-kanban-kit`'s flat
 * `BoardData` shape. That library is gone — `KannaBoard` draws the board itself
 * and drives `@atlaskit/pragmatic-drag-and-drop` directly — so the projection
 * went with it and only the two decisions that were never about the library
 * remain.
 */

import type { ColumnColorToken } from "../../../shared/boards/types"

/**
 * Column colour token to a Tailwind class.
 *
 * A literal lookup rather than `bg-${token}`: Tailwind scans source for
 * complete class names, so an interpolated one is never emitted and the dot
 * renders transparent.
 */
export const COLUMN_DOT_CLASS: Readonly<Record<ColumnColorToken, string>> = {
  "muted-icon": "bg-muted-icon",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
}

/** True when a column holds more cards than its WIP limit allows. Advisory only. */
export function isOverWipLimit(loaded: number, wipLimit: number | null): boolean {
  return wipLimit !== null && loaded > wipLimit
}
