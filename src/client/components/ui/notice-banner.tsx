import type { ReactNode } from "react"
import { cn } from "../../lib/utils"

export type NoticeBannerVariant = "info" | "warning" | "success" | "error"

interface NoticeBannerTone {
  dotVar: string
  bgClass: string
}

const TONES: Record<NoticeBannerVariant, NoticeBannerTone> = {
  info: { dotVar: "var(--info)", bgClass: "bg-info/[0.06]" },
  warning: { dotVar: "var(--warning)", bgClass: "bg-warning/[0.06]" },
  success: { dotVar: "var(--success)", bgClass: "bg-success/[0.06]" },
  error: { dotVar: "var(--destructive)", bgClass: "bg-destructive/[0.06]" },
}

export interface NoticeBannerProps {
  variant: NoticeBannerVariant
  children: ReactNode
  dot?: boolean
  className?: string
}

export function NoticeBanner({
  variant,
  children,
  dot = true,
  className,
}: NoticeBannerProps) {
  const tone = TONES[variant]
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-border px-4 py-2 text-xs leading-tight",
        tone.bgClass,
        className,
      )}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className="inline-block size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: tone.dotVar }}
        />
      ) : null}
      {children}
    </div>
  )
}
