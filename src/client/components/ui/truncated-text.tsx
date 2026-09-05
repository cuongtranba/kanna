import * as React from "react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip"
import { cn } from "../../lib/utils"

type TruncatedTextProps = {
  tooltip: React.ReactNode
  children: React.ReactNode
  className?: string
  inline?: boolean
  side?: React.ComponentProps<typeof TooltipContent>["side"]
}

export function TruncatedText({
  tooltip,
  children,
  className,
  inline = false,
  side,
}: TruncatedTextProps) {
  const triggerClass = cn("truncate", className)
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {inline ? (
            <span className={triggerClass}>{children}</span>
          ) : (
            <div className={triggerClass}>{children}</div>
          )}
        </TooltipTrigger>
        <TooltipContent side={side}>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

type HoverHintProps = {
  label: React.ReactNode
  children: React.ReactElement
  side?: React.ComponentProps<typeof TooltipContent>["side"]
}

export function HoverHint({ label, children, side }: HoverHintProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
