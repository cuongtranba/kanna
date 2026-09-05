import type { CSSProperties } from "react"
import { cn } from "../../lib/utils"
import { buildReduction } from "../../lib/reduction"

const LIVE_DOUBLE_OFFSET = 2

/**
 * Anchors the newest tick's growth to the baseline.
 *
 * `transform-box: view-box` puts the origin in the SVG's own coordinate system,
 * which is what makes `baselineY` — a viewBox number — mean anything here. The
 * x is irrelevant to a vertical scale, so it stays 0.
 */
function tickGrowOrigin(baselineY: number): CSSProperties {
  return { transformBox: "view-box", transformOrigin: `0 ${baselineY}px` }
}

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
        <g
          /*
            The newest tick is keyed on the turn count, not its index, so it
            remounts — and so replays its growth — on every new turn. Index
            keys alone stop working at MAX_TICKS: the window slides, the last
            index already exists, and nothing would ever animate again.
          */
          key={i === ticks.length - 1 ? `newest-${durationsMs.length}` : i}
          className={cn(
            tick.live ? "text-logo" : "text-muted-foreground",
            /*
              The session's history being written live: the newest stroke grows
              up out of the baseline rather than appearing at full height.

              scaleY from the baseline rather than the handoff's `y2` tween —
              same picture, but `x1/y1/x2/y2` are not CSS-animatable geometry
              properties in every engine (Firefox does not implement them),
              where a transform is, and is compositor-only besides.
            */
            i === ticks.length - 1 && "kanna-reduction-tick-in",
          )}
          style={i === ticks.length - 1 ? tickGrowOrigin(baselineY) : undefined}
        >
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
