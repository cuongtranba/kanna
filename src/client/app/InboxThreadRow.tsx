import { memo, useCallback } from "react"
import type { InboxThread } from "../../shared/inbox/types"
import { formatSidebarAgeLabel } from "../lib/formatters"
import { threadPreview, threadStateDisplay } from "../lib/inboxPresentation"
import { InboxRowShell } from "./InboxRowShell"

interface Props {
  thread: InboxThread
  selected: boolean
  now: number
  onOpen: (threadId: string) => void
}

function InboxThreadRowImpl({ thread, selected, now, onOpen }: Props) {
  const handleClick = useCallback(() => onOpen(thread.id), [onOpen, thread.id])
  return (
    <InboxRowShell
      unread={thread.unread}
      selected={selected}
      avatarName={thread.sender}
      title={thread.sender}
      subtitle={thread.sourceName}
      age={formatSidebarAgeLabel(thread.lastMessageAt, now)}
      preview={threadPreview(thread)}
      display={threadStateDisplay(thread)}
      meta={thread.messages.length > 1 ? `${String(thread.messages.length)} messages` : undefined}
      onClick={handleClick}
    />
  )
}

export const InboxThreadRow = memo(InboxThreadRowImpl)
