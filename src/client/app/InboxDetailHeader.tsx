import { useCallback } from "react"
import { Archive, ArrowLeft, ChevronDown, ChevronUp, ExternalLink } from "lucide-react"
import { Link } from "react-router-dom"
import type { InboxThread } from "../../shared/inbox/types"
import { Button } from "../components/ui/button"
import { StateMarkLabel } from "../components/ui/state-mark"
import { archiveInboxThread } from "../lib/inboxActions"
import { threadStateDisplay } from "../lib/inboxPresentation"
import { chatPath } from "../lib/paneTree"
import { pendingActionKey, usePendingAction } from "../stores/pendingActionsStore"
import { InboxAutonomyControls } from "./InboxAutonomyControls"
import { InboxAvatar } from "./InboxAvatar"
import { InboxShortcutHint } from "./InboxShortcutHint"
import { useOptionalKannaSocket } from "./KannaSocketProvider"

interface Props {
  thread: InboxThread
  prevId: string | null
  nextId: string | null
  onOpenThread: (threadId: string) => void
  onBack: () => void
  onArchived: () => void
}

export function InboxDetailHeader({ thread, prevId, nextId, onOpenThread, onBack, onArchived }: Props) {
  const socket = useOptionalKannaSocket()
  const display = threadStateDisplay(thread)
  const archiving = usePendingAction(pendingActionKey("inbox.archive", thread.id))
  const threadId = thread.id

  const handleArchive = useCallback(() => archiveInboxThread(socket, threadId, onArchived), [onArchived, socket, threadId])
  const handlePrev = useCallback(() => {
    if (prevId !== null) onOpenThread(prevId)
  }, [onOpenThread, prevId])
  const handleNext = useCallback(() => {
    if (nextId !== null) onOpenThread(nextId)
  }, [nextId, onOpenThread])

  return (
    <header className="shrink-0 space-y-2 border-b border-border bg-background px-4 py-3">
      <div className="mx-auto flex w-full max-w-[720px] items-center gap-2">
        <Button variant="ghost" size="sm" className="-ml-2 md:hidden" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
          Inbox
        </Button>
        <InboxAvatar name={thread.sender} className="max-md:hidden" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-foreground">{thread.sender}</h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="truncate">{thread.sourceName}</span>
            <StateMarkLabel tone={display.tone} label={display.label} />
            {thread.chatId === undefined ? null : (
              <Link
                to={chatPath(thread.chatId)}
                className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
              >
                Open chat
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>
        <InboxShortcutHint label="Previous thread" action="inboxPrevThread">
          <Button variant="ghost" size="icon-sm" aria-label="Previous thread" disabled={prevId === null} onClick={handlePrev}>
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          </Button>
        </InboxShortcutHint>
        <InboxShortcutHint label="Next thread" action="inboxNextThread">
          <Button variant="ghost" size="icon-sm" aria-label="Next thread" disabled={nextId === null} onClick={handleNext}>
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </Button>
        </InboxShortcutHint>
        <InboxShortcutHint label="Archive" action="inboxArchiveThread">
          <Button
            variant="secondary"
            size="sm"
            disabled={thread.state === "archived"}
            pending={archiving}
            onClick={handleArchive}
          >
            <Archive className="h-4 w-4 md:mr-1.5" aria-hidden="true" />
            <span className="max-md:sr-only">Archive</span>
          </Button>
        </InboxShortcutHint>
      </div>
      <div className="mx-auto w-full max-w-[720px] empty:hidden">
        <InboxAutonomyControls thread={thread} />
      </div>
    </header>
  )
}
