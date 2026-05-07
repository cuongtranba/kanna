import { useRunningTaskCount } from "../../stores/backgroundTasksStore"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip"

// ---------------------------------------------------------------------------
// Pure view — accepts count as a prop; testable without store.
// ---------------------------------------------------------------------------

interface ViewProps {
  count: number
  onOpen: () => void
}

export function BackgroundTasksIndicatorView({ count, onOpen }: ViewProps) {
  const hasActive = count > 0

  const tooltipLabel = hasActive
    ? `${count} background task${count === 1 ? "" : "s"} · ⌘⇧B`
    : "No background tasks · ⌘⇧B"

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onOpen}
          aria-label={tooltipLabel}
          className="inline-flex items-center gap-1.5 px-1.5 h-9 rounded-md hover:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span
            className="inline-block w-[7px] h-[7px] rounded-full flex-shrink-0"
            style={{ backgroundColor: hasActive ? "var(--warning)" : "var(--muted-foreground)" }}
            aria-hidden
          />
          <span
            className="text-xs font-mono font-medium tabular-nums leading-none"
            style={{ color: hasActive ? "var(--warning)" : "var(--muted-foreground)" }}
          >
            {count}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {tooltipLabel}
      </TooltipContent>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// Connected indicator — reads running count from the singleton store.
// ---------------------------------------------------------------------------

interface Props {
  onOpen: () => void
}

export function BackgroundTasksIndicator({ onOpen }: Props) {
  const count = useRunningTaskCount()
  return <BackgroundTasksIndicatorView count={count} onOpen={onOpen} />
}
