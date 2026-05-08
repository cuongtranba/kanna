import { X } from "lucide-react"
import { cn } from "../../lib/utils"

interface AttachmentUploadOverlayProps {
  progress: number | null
  onCancel?: () => void
  size?: "sm" | "md"
  className?: string
  cancelLabel?: string
}

const RADIUS = 18
const STROKE = 3
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const VIEWBOX = (RADIUS + STROKE) * 2

export function AttachmentUploadOverlay({
  progress,
  onCancel,
  size = "md",
  className,
  cancelLabel = "Cancel upload",
}: AttachmentUploadOverlayProps) {
  const isIndeterminate = progress == null
  const clamped = isIndeterminate ? 0 : Math.min(1, Math.max(0, progress))
  const percentLabel = isIndeterminate ? null : Math.round(clamped * 100)
  const dashOffset = CIRCUMFERENCE * (1 - clamped)

  const ringPx = size === "sm" ? 36 : 48

  return (
    <div
      className={cn(
        "pointer-events-auto absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/85",
        className,
      )}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percentLabel ?? undefined}
      aria-label={isIndeterminate ? "Uploading" : `Uploading, ${percentLabel}%`}
    >
      <div
        className={cn(
          "group/overlay relative inline-flex items-center justify-center",
          isIndeterminate && "motion-safe:animate-spin",
        )}
        style={{ width: ringPx, height: ringPx }}
      >
        <svg
          viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
          width={ringPx}
          height={ringPx}
          className="absolute inset-0 -rotate-90"
          aria-hidden="true"
        >
          <circle
            cx={VIEWBOX / 2}
            cy={VIEWBOX / 2}
            r={RADIUS}
            stroke="currentColor"
            strokeWidth={STROKE}
            fill="none"
            className="text-border"
          />
          <circle
            cx={VIEWBOX / 2}
            cy={VIEWBOX / 2}
            r={RADIUS}
            stroke="currentColor"
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={isIndeterminate ? CIRCUMFERENCE * 0.75 : dashOffset}
            className={cn(
              "motion-safe:transition-[stroke-dashoffset] motion-safe:duration-150 motion-safe:ease-out",
              onCancel ? "text-foreground group-hover/overlay:text-destructive" : "text-foreground",
            )}
          />
        </svg>

        {percentLabel !== null ? (
          <span
            className={cn(
              "pointer-events-none select-none font-mono tabular-nums text-foreground transition-opacity",
              size === "sm" ? "text-[10px]" : "text-xs",
              onCancel && "group-hover/overlay:opacity-0",
            )}
          >
            {percentLabel}%
          </span>
        ) : null}

        {onCancel ? (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onCancel()
            }}
            className={cn(
              "absolute inset-0 flex items-center justify-center rounded-full text-destructive transition-opacity",
              percentLabel !== null ? "opacity-0 group-hover/overlay:opacity-100" : "",
              "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive",
            )}
            aria-label={cancelLabel}
          >
            <X className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
          </button>
        ) : null}
      </div>
    </div>
  )
}
