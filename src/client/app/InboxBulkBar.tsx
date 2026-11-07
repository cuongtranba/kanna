import { useCallback } from "react"
import { Archive, Mail, MailOpen } from "lucide-react"
import { Button } from "../components/ui/button"
import { archiveActionKey, archiveInboxThreads, readActionKey, setInboxThreadsRead } from "../lib/inboxActions"
import { useInboxStore } from "../stores/inboxStore"
import { usePendingAction } from "../stores/pendingActionsStore"
import { useOptionalKannaSocket } from "./KannaSocketProvider"

interface Props {
  threadIds: readonly string[]
  onArchived: (threadIds: readonly string[]) => void
}

export function InboxBulkBar({ threadIds, onArchived }: Props) {
  const socket = useOptionalKannaSocket()
  const archiving = usePendingAction(archiveActionKey(threadIds))
  const markingRead = usePendingAction(readActionKey(threadIds, true))
  const markingUnread = usePendingAction(readActionKey(threadIds, false))

  const handleClear = useCallback(() => {
    useInboxStore.getState().clearChecked()
  }, [])
  const handleMarkRead = useCallback(() => {
    setInboxThreadsRead(socket, threadIds, true, handleClear)
  }, [handleClear, socket, threadIds])
  const handleMarkUnread = useCallback(() => {
    setInboxThreadsRead(socket, threadIds, false, handleClear)
  }, [handleClear, socket, threadIds])
  const handleArchive = useCallback(() => {
    archiveInboxThreads(socket, threadIds, () => onArchived(threadIds))
  }, [onArchived, socket, threadIds])

  return (
    <div role="toolbar" aria-label="Bulk actions" className="flex flex-wrap items-center gap-2">
      <span role="status" className="mr-1 text-sm font-medium tabular-nums text-foreground">
        {threadIds.length} selected
      </span>
      <Button size="sm" variant="secondary" pending={markingRead} onClick={handleMarkRead}>
        <MailOpen className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Mark read
      </Button>
      <Button size="sm" variant="secondary" pending={markingUnread} onClick={handleMarkUnread}>
        <Mail className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Mark unread
      </Button>
      <Button size="sm" variant="secondary" pending={archiving} onClick={handleArchive}>
        <Archive className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Archive
      </Button>
      <Button size="sm" variant="ghost" onClick={handleClear}>
        Clear
      </Button>
    </div>
  )
}
