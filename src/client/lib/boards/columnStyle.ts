
import type { ColumnColorToken } from "../../../shared/boards/types"

export const COLUMN_DOT_CLASS: Readonly<Record<ColumnColorToken, string>> = {
  "muted-icon": "bg-muted-icon",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
}

export function isOverWipLimit(loaded: number, wipLimit: number | null): boolean {
  return wipLimit !== null && loaded > wipLimit
}
