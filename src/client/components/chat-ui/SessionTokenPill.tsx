import {
  type ContextWindowSnapshot,
  computeSessionTokenSummary,
  formatContextWindowTokens,
} from "../../lib/contextWindow"
import { cn } from "../../lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip"

interface SessionTokenPillProps {
  usage: ContextWindowSnapshot | null
  className?: string
}

export function SessionTokenPill({ usage, className }: SessionTokenPillProps) {
  const summary = computeSessionTokenSummary(usage)
  if (!summary) return null

  const cacheLabel = summary.cacheHitPercentage === null
    ? null
    : formatCachePercentage(summary.cacheHitPercentage)

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={buildAriaLabel(summary, cacheLabel)}
          className={cn(
            "inline-flex cursor-default items-center gap-1.5 rounded-md bg-muted/30 px-2 py-0.5 text-xs tabular-nums text-muted-foreground",
            className,
          )}
        >
          <Stat label="in" value={formatContextWindowTokens(summary.input)} />
          <Separator />
          <Stat label="out" value={formatContextWindowTokens(summary.output)} />
          {cacheLabel !== null
            ? (
              <>
                <Separator />
                <Stat label="cache" value={cacheLabel} />
              </>
            )
            : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" className="w-max max-w-none px-3 py-2">
        <div className="space-y-1 text-xs leading-tight">
          <Row label="Input" value={formatContextWindowTokens(summary.input)} />
          <Row label="Output" value={formatContextWindowTokens(summary.output)} />
          <Row label="Cache read" value={formatContextWindowTokens(summary.cached)} />
          {cacheLabel !== null
            ? <Row label="Cache hit" value={cacheLabel} />
            : null}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 tabular-nums">
      <span className="font-medium text-foreground">{value}</span>
      <span>{label}</span>
    </span>
  )
}

function Separator() {
  return <span aria-hidden="true" className="text-muted-foreground/50">·</span>
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 whitespace-nowrap">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  )
}

function formatCachePercentage(value: number): string {
  const clamped = Math.max(0, Math.min(100, value))
  if (clamped < 10) {
    return `${clamped.toFixed(1).replace(/\.0$/, "")}%`
  }
  return `${Math.round(clamped)}%`
}

function buildAriaLabel(
  summary: { input: number; output: number; cached: number },
  cacheLabel: string | null,
): string {
  const parts = [
    `Input ${formatContextWindowTokens(summary.input)}`,
    `Output ${formatContextWindowTokens(summary.output)}`,
    `Cache ${formatContextWindowTokens(summary.cached)}`,
  ]
  if (cacheLabel !== null) parts.push(`hit ${cacheLabel}`)
  return `Session tokens: ${parts.join(", ")}`
}

