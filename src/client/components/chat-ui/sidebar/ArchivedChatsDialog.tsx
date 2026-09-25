import type { SidebarChatRow, SidebarProjectGroup } from "../../../../shared/types"
import { formatSidebarAgeLabel } from "../../../lib/formatters"
import { getSidebarChatTimestamp } from "../../../lib/sidebarChats"
import { pendingActionKey, runPendingAction, usePendingAction } from "../../../stores/pendingActionsStore"
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/dialog"
import { Spinner } from "../../ui/spinner"

function unarchiveKey(chatId: string): string {
  return pendingActionKey("chat.unarchive", chatId)
}

function ArchivedChatButton({
  chat,
  nowMs,
  onOpenChat,
}: {
  chat: SidebarChatRow
  nowMs: number
  onOpenChat: (chatId: string) => Promise<void>
}) {
  const pending = usePendingAction(unarchiveKey(chat.chatId))
  return (
    <button
      type="button"
      disabled={pending}
      aria-busy={pending || undefined}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-border/0 px-3 py-2 text-left transition-colors hover:border-border hover:bg-muted disabled:opacity-70"
      onClick={() => runPendingAction(unarchiveKey(chat.chatId), () => onOpenChat(chat.chatId))}
    >
      <span className="min-w-0 truncate text-sm">{chat.title}</span>
      {pending ? (
        <Spinner className="text-muted-foreground" />
      ) : (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatSidebarAgeLabel(getSidebarChatTimestamp(chat), nowMs)}
        </span>
      )}
    </button>
  )
}

export function ArchivedChatsDialog({
  project,
  nowMs,
  onOpenChange,
  onOpenChat,
}: {
  project: SidebarProjectGroup | null
  nowMs: number
  onOpenChange: (open: boolean) => void
  onOpenChat: (chatId: string) => Promise<void>
}) {
  return (
    <Dialog open={Boolean(project)} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Archived Chats</DialogTitle>
          <DialogDescription>
            {project?.localPath ?? ""}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-1">
          {project?.archivedChats?.length ? (
            project.archivedChats.map((chat) => (
              <ArchivedChatButton key={chat.chatId} chat={chat} nowMs={nowMs} onOpenChat={onOpenChat} />
            ))
          ) : (
            <p className="px-1 py-3 text-sm text-muted-foreground">No archived chats</p>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
