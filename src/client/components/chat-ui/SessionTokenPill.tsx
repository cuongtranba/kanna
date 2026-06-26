import {
  type SessionTotals,
  formatContextWindowTokens,
  formatCostUsd,
} from "../../lib/contextWindow"
import { cn } from "../../lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"

interface SessionTokenPillProps {
  totals: SessionTotals | null
  className?: string
}

export function SessionTokenPill({ totals, className }: SessionTokenPillProps) {
  if (!totals) return null

  const cacheLabel = totals.cacheHitPercentage === null
    ? null
    : formatCachePercentage(totals.cacheHitPercentage)

  const hasCost = totals.costUsd > 0
  const costLabel = hasCost ? formatCostUsd(totals.costUsd) : null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={buildAriaLabel(totals, cacheLabel, costLabel)}
          className={cn(
            "inline-flex min-h-[36px] cursor-pointer touch-manipulation items-center gap-1.5 rounded-md bg-muted/30 px-2.5 py-1.5 text-xs tabular-nums text-muted-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <Stat label="in" value={formatContextWindowTokens(totals.inputTokens)} />
          <Separator />
          <Stat label="out" value={formatContextWindowTokens(totals.outputTokens)} />
          {cacheLabel !== null
            ? (
              <>
                <Separator />
                <Stat label="cache" value={cacheLabel} />
              </>
            )
            : null}
          {costLabel !== null
            ? (
              <>
                <Separator />
                <span className="tabular-nums">{costLabel}</span>
              </>
            )
            : null}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="w-max max-w-none px-3 py-2">
        <div className="space-y-1 text-xs leading-tight">
          <Row label="Input" value={formatContextWindowTokens(totals.inputTokens)} />
          <Row label="Output" value={formatContextWindowTokens(totals.outputTokens)} />
          <Row label="Cache read" value={formatContextWindowTokens(totals.cachedTokens)} />
          {cacheLabel !== null
            ? <Row label="Cache hit" value={cacheLabel} />
            : null}
          {costLabel !== null
            ? <Row label="Cost" value={costLabel} />
            : null}
        </div>
      </PopoverContent>
    </Popover>
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
  totals: SessionTotals,
  cacheLabel: string | null,
  costLabel: string | null,
): string {
  const parts = [
    `Input ${formatContextWindowTokens(totals.inputTokens)}`,
    `Output ${formatContextWindowTokens(totals.outputTokens)}`,
    `Cache ${formatContextWindowTokens(totals.cachedTokens)}`,
  ]
  if (cacheLabel !== null) parts.push(`hit ${cacheLabel}`)
  if (costLabel !== null) parts.push(`cost ${costLabel}`)
  return `Session tokens: ${parts.join(", ")}`
}
