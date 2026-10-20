import { memo, useCallback } from "react"
import type { InboxActivityItem } from "../../shared/inbox/types"
import { StateMarkLabel } from "../components/ui/state-mark"
import { formatStartedClock } from "../lib/formatters"
import { itemSourceName, itemStateDisplay, subjectLabel } from "../lib/inboxPresentation"
import { cn } from "../lib/utils"

interface Props {
  item: InboxActivityItem
  onOpen: (item: InboxActivityItem) => void
}

function InboxActivityRowImpl({ item, onOpen }: Props) {
  const handleClick = useCallback(() => onOpen(item), [onOpen, item])
  const display = itemStateDisplay(item)
  return (
    <button
      type="button"
      onClick={handleClick}
      className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-4 py-2.5 text-left transition-colors duration-[var(--motion-quick)] hover:bg-muted/50 motion-reduce:transition-none"
    >
      <span className={cn("truncate text-sm text-foreground", item.unread ? "font-semibold" : "font-medium")}>
        {item.unread ? <span className="sr-only">Unread. </span> : null}
        {item.title}
        <span className="font-normal text-muted-foreground"> · {itemSourceName(item.source)} · {subjectLabel(item.subject)}</span>
      </span>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatStartedClock(item.ts)}</span>
      <span className="col-span-2 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <StateMarkLabel tone={display.tone} label={display.label} className="shrink-0" />
        <span className="truncate">{item.preview}</span>
      </span>
    </button>
  )
}

export const InboxActivityRow = memo(InboxActivityRowImpl)
