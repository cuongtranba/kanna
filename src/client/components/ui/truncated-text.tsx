import * as React from "react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip"
import { cn } from "../../lib/utils"

type TruncatedTextProps = {
  /** Tooltip content shown on hover; the full/expanded value. */
  tooltip: React.ReactNode
  /** Visible (usually shortened/truncated) content. */
  children: React.ReactNode
  className?: string
  /** Render as a block `div` (default) or inline `span`. */
  inline?: boolean
  side?: React.ComponentProps<typeof TooltipContent>["side"]
}

/**
 * Truncated text with a project-Tooltip hover surface — the DESIGN.md-approved
 * replacement for the native `title` attribute on truncated cells. Ships its
 * own `TooltipProvider` so it is self-contained (nested providers are safe).
 */
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
  /** Tooltip content shown on hover. */
  label: React.ReactNode
  /** Single element child (a button, span, badge, …) — Radix `asChild` clones it. */
  children: React.ReactElement
  side?: React.ComponentProps<typeof TooltipContent>["side"]
}

/**
 * Wraps a single element with a project-Tooltip hover surface — the
 * DESIGN.md-approved replacement for a native `title` attribute on icon
 * buttons, badges, and other non-truncated elements. Ships its own
 * `TooltipProvider` so it is self-contained (nested providers are safe).
 */
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
