import { memo, useCallback } from "react"
import type { InboxThread } from "../../shared/inbox/types"
import { StateMarkLabel } from "../components/ui/state-mark"
import { formatStartedClock } from "../lib/formatters"
import { threadPreview, threadStateDisplay } from "../lib/inboxPresentation"
import { cn } from "../lib/utils"

interface Props {
  thread: InboxThread
  selected: boolean
  onOpen: (threadId: string) => void
}

function InboxThreadRowImpl({ thread, selected, onOpen }: Props) {
  const handleClick = useCallback(() => onOpen(thread.id), [onOpen, thread.id])
  const display = threadStateDisplay(thread)
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-4 py-2.5 text-left transition-colors duration-[var(--motion-quick)] motion-reduce:transition-none",
        selected ? "bg-muted" : "hover:bg-muted/50",
      )}
    >
      <span className={cn("truncate text-sm text-foreground", thread.unread ? "font-semibold" : "font-medium")}>
        {thread.unread ? <span className="sr-only">Unread. </span> : null}
        {thread.sender}
        <span className="font-normal text-muted-foreground"> · {thread.sourceName}</span>
      </span>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatStartedClock(thread.lastMessageAt)}</span>
      <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <StateMarkLabel tone={display.tone} label={display.label} className="shrink-0" />
        <span className="truncate">{threadPreview(thread)}</span>
      </span>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {thread.messages.length > 1 ? `${String(thread.messages.length)} messages` : ""}
      </span>
    </button>
  )
}

export const InboxThreadRow = memo(InboxThreadRowImpl)
