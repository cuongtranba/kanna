import { useCallback } from "react"
import { Clock } from "lucide-react"
import { Button } from "../components/ui/button"
import { unsnoozeActionKey, unsnoozeInboxThread } from "../lib/inboxActions"
import { formatSnoozeUntil } from "../lib/inboxSnooze"
import { selectSnapshotAt, useInboxStore } from "../stores/inboxStore"
import { usePendingAction } from "../stores/pendingActionsStore"
import { useOptionalKannaSocket } from "./KannaSocketProvider"

interface Props {
  threadId: string
  until: number
}

export function InboxSnoozedNotice({ threadId, until }: Props) {
  const socket = useOptionalKannaSocket()
  const snapshotAt = useInboxStore(selectSnapshotAt)
  const unsnoozing = usePendingAction(unsnoozeActionKey(threadId))
  const handleUnsnooze = useCallback(() => unsnoozeInboxThread(socket, threadId), [socket, threadId])
  return (
    <div className="mx-auto flex w-full max-w-[720px] items-center gap-2 text-xs text-muted-foreground">
      <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate tabular-nums">Snoozed until {formatSnoozeUntil(until, snapshotAt)}</span>
      <Button variant="secondary" size="sm" pending={unsnoozing} onClick={handleUnsnooze}>
        Unsnooze
      </Button>
    </div>
  )
}
