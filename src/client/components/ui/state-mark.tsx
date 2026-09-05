import { cn } from "../../lib/utils"
import { stateMarkKind, stateMarkStrokes } from "../../lib/stateMark"
import { statusToneClass, type StatusTone } from "../../lib/statusLabel"

export function StateMark({ tone, className }: { tone: StatusTone; className?: string }) {
  const strokes = stateMarkStrokes(stateMarkKind(tone))
  return (
    <svg
      aria-hidden
      viewBox="0 0 9 13"
      className={cn("inline-block h-3.5 w-[9px] shrink-0 align-[-2px]", className)}
    >
      {strokes.map((s, i) => (
        <line
          key={i}
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          stroke="currentColor"
          strokeWidth={1.5}
        />
      ))}
    </svg>
  )
}

export function StateMarkLabel({
  tone,
  label,
  className,
}: {
  tone: StatusTone
  label: string
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[7px] font-mono text-xs tracking-wide tabular-nums",
        statusToneClass(tone),
        className,
      )}
    >
      <StateMark tone={tone} />
      {label}
    </span>
  )
}
