import type { ReactNode } from "react"
import { cn } from "../../lib/utils"

/**
 * A plate is the replacement for the card: space, one hairline, and a caption.
 *
 * No box, no radius, no shadow, and no nesting — the chrome a card spends on its
 * own edges is exactly the white this surface is made of. A plate that needs a
 * border to be findable is a plate whose caption is not doing its job.
 *
 * The rule and the air are carried ABOVE the plate, never below. A bottom
 * margin changes the rendered height of a plate that is already painted, which
 * in a streaming list forces a re-measure while scroll position is being held;
 * `transcriptSpacing.ts` documents the jitter that caused. The transcript gets
 * its own rule from that rhythm table rather than from this component — this is
 * for the static surfaces (panels, settings, boards detail).
 */
export function Plate({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        "border-t border-border pt-8 first:border-t-0 first:pt-0",
        className,
      )}
    >
      {children}
    </section>
  )
}

interface PlateCaptionProps {
  /** Position in the transcript. Rendered zero-padded so the column cannot reflow. */
  readonly index: number
  /** What this plate holds — "Prompt", "Reply", "Diff", "Check". */
  readonly kind: string
  /**
   * A live fact about THIS plate: a duration, a count, a tally, a filename.
   *
   * Required on purpose. Every label states a fact, and a caption with nothing
   * to state is deleted rather than styled — making this optional is how that
   * rule quietly becomes decoration.
   */
  readonly fact: string
  readonly className?: string
}

export function PlateCaption({ index, kind, fact, className }: PlateCaptionProps) {
  return (
    <div
      className={cn(
        "mb-3.5 flex items-baseline gap-2.5 font-mono text-xs tracking-wide tabular-nums text-muted-foreground",
        className,
      )}
    >
      <span className="font-medium text-foreground">Plate {formatPlateIndex(index)}</span>
      <span aria-hidden className="text-border">·</span>
      <span>{kind}</span>
      <span className="ml-auto truncate pl-4">{fact}</span>
    </div>
  )
}

export function formatPlateIndex(index: number): string {
  return index < 10 ? `0${index}` : String(index)
}

/**
 * A panel's running head: what the section is, and one fact about it.
 *
 * The same discipline `PlateCaption` enforces for a transcript entry, at the
 * scale of a sidebar section. `fact` is optional here — unlike a plate, a
 * section can legitimately have nothing countable to say (a single-value
 * panel), and inventing a number to satisfy the rule would be worse than
 * omitting it. When there IS a count, showing it is free and saves the reader
 * a scan.
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
