import { memo, useCallback } from "react"
import type { InboxActivityItem } from "../../shared/inbox/types"
import { formatSidebarAgeLabel } from "../lib/formatters"
import { itemSourceName, itemStateDisplay, subjectLabel } from "../lib/inboxPresentation"
import { InboxRowShell } from "./InboxRowShell"

interface Props {
  item: InboxActivityItem
  now: number
  onOpen: (item: InboxActivityItem) => void
}

function InboxActivityRowImpl({ item, now, onOpen }: Props) {
  const handleClick = useCallback(() => onOpen(item), [onOpen, item])
  const source = itemSourceName(item.source)
  return (
    <InboxRowShell
      unread={item.unread}
      selected={false}
      avatarName={source}
      title={item.title}
      subtitle={`${source} · ${subjectLabel(item.subject)}`}
      age={formatSidebarAgeLabel(item.ts, now)}
      preview={item.preview}
      display={itemStateDisplay(item)}
      onClick={handleClick}
    />
  )
}

export const InboxActivityRow = memo(InboxActivityRowImpl)
