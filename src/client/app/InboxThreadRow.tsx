import { memo, useCallback, useMemo } from "react"
import type { InboxThread } from "../../shared/inbox/types"
import { formatSidebarAgeLabel } from "../lib/formatters"
import { threadPreview, threadStateDisplay } from "../lib/inboxPresentation"
import { snoozedDisplay } from "../lib/inboxSnooze"
import { useInboxStore } from "../stores/inboxStore"
import { InboxRowShell, type InboxRowSelection } from "./InboxRowShell"

interface Props {
  thread: InboxThread
  selected: boolean
  checked: boolean
  anyChecked: boolean
  now: number
  onOpen: (threadId: string) => void
}

function InboxThreadRowImpl({ thread, selected, checked, anyChecked, now, onOpen }: Props) {
  const handleClick = useCallback(() => onOpen(thread.id), [onOpen, thread.id])
  const threadId = thread.id
  const handleToggle = useCallback(() => useInboxStore.getState().toggleChecked(threadId), [threadId])
  const selection = useMemo<InboxRowSelection>(
    () => ({ checked, anyChecked, label: `Select thread from ${thread.sender}`, onToggle: handleToggle }),
    [anyChecked, checked, handleToggle, thread.sender],
  )
  return (
    <InboxRowShell
      unread={thread.unread}
      selected={selected}
      avatarName={thread.sender}
      title={thread.sender}
      subtitle={thread.sourceName}
      age={formatSidebarAgeLabel(thread.lastMessageAt, now)}
      preview={threadPreview(thread)}
      display={thread.snoozedUntil === undefined ? threadStateDisplay(thread) : snoozedDisplay(thread.snoozedUntil, now)}
      meta={thread.messages.length > 1 ? `${String(thread.messages.length)} messages` : undefined}
      selection={selection}
      onClick={handleClick}
    />
  )
}

export const InboxThreadRow = memo(InboxThreadRowImpl)
