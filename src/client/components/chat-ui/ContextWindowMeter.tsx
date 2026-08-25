import { cn } from "../../lib/utils"
import { type ContextWindowSnapshot, formatContextWindowTokens } from "../../lib/contextWindow"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"

function formatPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null
  }
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`
  }
  return `${Math.round(value)}%`
}

export function ContextWindowMeter({ usage }: { usage: ContextWindowSnapshot }) {
  const usedPercentage = formatPercentage(usage.usedPercentage)
  const normalizedPercentage = Math.max(0, Math.min(100, usage.usedPercentage ?? 0))
  const radius = 9.75
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - (normalizedPercentage / 100) * circumference

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group inline-flex h-9 w-9 cursor-pointer touch-manipulation items-center justify-center rounded-full transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={
            usage.maxTokens !== undefined && usedPercentage
              ? `Context window ${usedPercentage} used`
              : `Context window ${formatContextWindowTokens(usage.usedTokens)} tokens used`
          }
        >
          <span className="relative flex h-6 w-6 items-center justify-center">
            <svg
              viewBox="0 0 24 24"
              className="-rotate-90 absolute inset-0 h-full w-full transform-gpu"
              aria-hidden="true"
            >
              <circle
                cx="12"
                cy="12"
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-muted-foreground/20"
              />
              <circle
                cx="12"
                cy="12"
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                className="text-muted-foreground transition-[stroke-dashoffset] duration-500 ease-out"
              />
            </svg>
            <span
              className={cn(
                "relative flex size-5 items-center justify-center rounded-full bg-background text-xs font-medium",
                "text-muted-foreground",
              )}
            >
              {usage.usedPercentage !== null
                ? Math.round(usage.usedPercentage)
                : formatContextWindowTokens(usage.usedTokens)}
            </span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="w-max max-w-none px-3 py-2">
        <div className="space-y-1.5 leading-tight">
          {usage.maxTokens !== undefined && usedPercentage ? (
            <div className="whitespace-nowrap text-xs font-medium text-foreground">
              <span>{usedPercentage}</span>
              <span className="mx-1">·</span>
              <span>{formatContextWindowTokens(usage.usedTokens)}</span>
              <span>/</span>
              <span>{formatContextWindowTokens(usage.maxTokens)} context used</span>
            </div>
          ) : (
            <div className="text-sm text-foreground">
              {formatContextWindowTokens(usage.usedTokens)} tokens used so far
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
