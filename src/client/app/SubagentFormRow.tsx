import * as React from "react"
import { cn } from "../lib/utils"

export function FormRow(props: {
  label: string
  hint?: string | null
  hintTone?: "muted" | "destructive"
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-foreground">{props.label}</span>
      {props.children}
      {props.hint ? (
        <span
          className={cn(
            "text-xs",
            props.hintTone === "destructive" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {props.hint}
        </span>
      ) : null}
    </div>
  )
}
