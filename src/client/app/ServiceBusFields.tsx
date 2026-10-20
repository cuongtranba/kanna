import type { ReactNode } from "react"
import { cn } from "../lib/utils"

export function Field({
  label,
  note,
  warn = false,
  children,
}: {
  label: string
  note?: string
  warn?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="text-13 font-medium text-foreground">{label}</div>
      {children}
      {note ? <div className={cn("text-xs", warn ? "text-warning-text" : "text-muted-foreground")}>{note}</div> : null}
    </div>
  )
}

export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-13 tabular-nums text-foreground">{value}</dd>
    </div>
  )
}

export function Problems({ problems }: { problems: readonly string[] }) {
  if (problems.length === 0) return null
  return (
    <ul className="flex flex-col gap-0.5 text-xs text-destructive-text" role="alert">
      {problems.map((problem) => (
        <li key={problem}>{problem}</li>
      ))}
    </ul>
  )
}
