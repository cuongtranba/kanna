import { cn } from "../../lib/utils"
import { buildReduction } from "../../lib/reduction"

const LIVE_DOUBLE_OFFSET = 2

/**
 * The session's colophon. Decorative-looking and not decorative: every tick is a
 * turn that happened, so this is a read of the session, not a flourish on it.
 */
export function Reduction({
  durationsMs,
  live = false,
  label,
  className,
}: {
  durationsMs: readonly number[]
  live?: boolean
  /** What this sigil says in words, for anyone not reading the picture. */
  label: string
  className?: string
}) {
  const { ticks, baselineY, size } = buildReduction(durationsMs, { live })

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("h-[26px] w-[26px] shrink-0", className)}
    >
      <line
        x1={1}
        y1={baselineY}
        x2={size - 1}
        y2={baselineY}
        stroke="currentColor"
        strokeWidth={1}
        className="text-border"
      />
      {ticks.map((tick, i) => (
        <g key={i} className={tick.live ? "text-logo" : "text-muted-foreground"}>
          <line
            x1={tick.x}
            y1={baselineY - 0.5}
            x2={tick.x}
            y2={tick.topY}
            stroke="currentColor"
            strokeWidth={1.4}
          />
          {tick.live ? (
            <line
              x1={tick.x + LIVE_DOUBLE_OFFSET}
              y1={baselineY - 0.5}
              x2={tick.x + LIVE_DOUBLE_OFFSET}
              y2={tick.topY}
              stroke="currentColor"
              strokeWidth={1.4}
            />
          ) : null}
        </g>
      ))}
    </svg>
  )
}
