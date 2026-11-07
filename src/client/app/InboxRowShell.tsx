import { StateMarkLabel } from "../components/ui/state-mark"
import type { InboxStateDisplay } from "../lib/inboxPresentation"
import { cn } from "../lib/utils"
import { InboxAvatar } from "./InboxAvatar"

interface Props {
  unread: boolean
  selected: boolean
  avatarName: string
  title: string
  subtitle: string
  age: string | null
  preview: string
  display: InboxStateDisplay
  meta?: string
  onClick: () => void
}

export function InboxRowShell({ unread, selected, avatarName, title, subtitle, age, preview, display, meta, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors duration-[var(--motion-quick)] motion-reduce:transition-none",
        selected ? "bg-muted" : "hover:bg-muted/50",
      )}
    >
      <span aria-hidden="true" className={cn("mt-[14px] h-2 w-2 shrink-0 rounded-full", unread ? "bg-info" : "bg-transparent")} />
      <InboxAvatar name={avatarName} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-baseline gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm text-foreground", unread ? "font-semibold" : "font-medium")}>
            {unread ? <span className="sr-only">Unread. </span> : null}
            {title}
            <span className="font-normal text-muted-foreground"> · {subtitle}</span>
          </span>
          {age === null ? null : <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{age}</span>}
        </span>
        <span className="line-clamp-2 break-words text-xs text-muted-foreground">{preview}</span>
        <span className="flex items-center gap-3">
          <StateMarkLabel tone={display.tone} label={display.label} className="shrink-0" />
          {meta === undefined ? null : <span className="font-mono text-xs tabular-nums text-muted-foreground">{meta}</span>}
        </span>
      </span>
    </button>
  )
}
