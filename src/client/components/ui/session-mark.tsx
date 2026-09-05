import { cn } from "../../lib/utils"
import type { SessionMarkKind } from "../../lib/chatStatusIndicator"

const R = 4
const C = 6

export function SessionMark({
  kind,
  className,
}: {
  kind: SessionMarkKind
  className?: string
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      className={cn("inline-block size-3 shrink-0", className)}
    >
      {kind === "filled" ? <circle cx={C} cy={C} r={R} fill="currentColor" /> : null}

      {kind === "half" ? (
        <>
          <circle cx={C} cy={C} r={R} fill="none" stroke="currentColor" strokeWidth={1.25} />
          <path d={`M ${C} ${C - R} A ${R} ${R} 0 0 0 ${C} ${C + R} Z`} fill="currentColor" />
        </>
      ) : null}

      {kind === "ring" ? (
        <circle cx={C} cy={C} r={R} fill="none" stroke="currentColor" strokeWidth={1.25} />
      ) : null}

      {kind === "dashed" ? (
        <circle
          cx={C}
          cy={C}
          r={R}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
          strokeDasharray="2 2"
        />
      ) : null}
    </svg>
  )
}
