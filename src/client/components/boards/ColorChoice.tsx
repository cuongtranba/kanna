import { cn } from "../../lib/utils"
import { COLUMN_DOT_CLASS } from "../../lib/boards/columnStyle"
import type { ColumnColorToken } from "../../../shared/boards/types"

/**
 * One swatch in the board palette.
 *
 * Shared by the column editor and the card-schema editor so a colour cannot
 * come to mean two different sizes or shapes depending on which one is open.
 * The token rides the button's `value`, which is what lets a whole row of these
 * share one handler instead of an arrow per swatch.
 *
 * Rendered as a dot, never as a fill: the palette is a marker, and a coloured
 * background would be the rainbow-column look the design brief rules out.
 */
export function ColorChoice({
  token,
  selected,
  label,
  onSelect,
}: {
  token: ColumnColorToken | null
  selected: boolean
  /** What this swatch is called out loud. The dot alone communicates nothing. */
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
