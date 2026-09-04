import { cn } from "../../lib/utils"

/**
 * A panel's running head: what the section is, and one fact about it.
 *
 * `fact` is optional — a single-value panel has nothing countable, and
 * inventing a number to satisfy a rule would be worse than omitting it.
 *
 * This file once also exported `Plate` and `PlateCaption`, a numbered
 * "Plate 04 · Diff · +4 −7" caption for every transcript entry. Both were
 * deleted after the finish review found them unused: the transcript gets its
 * space and hairline from `transcriptSpacing.ts`, and a numbered caption above
 * every entry — right in the showcase prototype — reads as noise in a dense
 * working transcript, where the speaker gloss, the rule, and each row's own
 * header already carry it. The rule survives where it earns its place, which
 * is section headers.
 */
export function SectionCaption({
  label,
  fact,
  className,
}: {
  readonly label: string
  readonly fact?: string
  readonly className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-baseline gap-2 px-1 py-1 font-mono text-xs tracking-wide tabular-nums text-muted-foreground",
        className,
      )}
    >
      <span>{label}</span>
      {fact === undefined ? null : <span className="ml-auto pl-3 truncate">{fact}</span>}
    </div>
  )
}
