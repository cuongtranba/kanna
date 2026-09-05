import { cn } from "../../lib/utils"

export function SectionCaption({
  label,
  fact,
  className,
}: {
  readonly label: string
  readonly fact?: string
  readonly className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-baseline gap-2 px-1 py-1 font-mono text-xs tracking-wide tabular-nums text-muted-foreground",
        className,
      )}
    >
      <span>{label}</span>
      {fact === undefined ? null : <span className="ml-auto pl-3 truncate">{fact}</span>}
    </div>
  )
}
