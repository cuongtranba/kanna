import { MetaRow, MetaLabel } from "./shared"

function formatTurnDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`

  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`
  if (minutes > 0) return `${minutes}m${seconds > 0 ? ` ${seconds}s` : ""}`
  return `${seconds}s`
}

interface Props {
  durationMs: number
  prefix?: string
}

export function TurnDurationFooter({ durationMs, prefix = "Worked for" }: Props) {
  if (durationMs <= 0) return null
  return (
    <MetaRow className="px-0.5 text-xs tracking-wide">
      <div className="w-full h-[1px] bg-border"></div>
      <MetaLabel className="whitespace-nowrap text-[11px] tracking-widest text-muted-foreground/60 uppercase flex-shrink-0">
        {prefix} {formatTurnDuration(durationMs)}
      </MetaLabel>
      <div className="w-full h-[1px] bg-border"></div>
    </MetaRow>
  )
}
