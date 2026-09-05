import { cn } from "../../lib/utils"
import { COLUMN_DOT_CLASS } from "../../lib/boards/columnStyle"
import type { ColumnColorToken } from "../../../shared/boards/types"

export function ColorChoice({
  token,
  selected,
  label,
  onSelect,
}: {
  token: ColumnColorToken | null
  selected: boolean
  label: string
  onSelect: (event: React.MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      value={token ?? ""}
      onClick={onSelect}
      aria-label={label}
      aria-pressed={selected}
      className={cn(
        "flex size-6 items-center justify-center rounded-md border",
        selected ? "border-ring" : "border-transparent hover:border-border",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          token ? COLUMN_DOT_CLASS[token] : "border border-border bg-transparent",
        )}
      />
    </button>
  )
}
