import type { InboxThread } from "../../shared/inbox/types"
import type { CommandPort } from "../ports/commandPort"
import { useInboxStore } from "../stores/inboxStore"
import { pendingActionKey, runPendingAction } from "../stores/pendingActionsStore"
import { sendCommandWithFeedback } from "./commandFeedback"
import { sonnerInboxToastPort, type InboxToastPort } from "./inboxToast"

export function archiveActionKey(threadIds: readonly string[]): string {
  return pendingActionKey("inbox.archive", ...threadIds)
}

export function readActionKey(threadIds: readonly string[], read: boolean): string {
  return pendingActionKey(read ? "inbox.markRead" : "inbox.markUnread", ...threadIds)
}

function archivedTitle(count: number): string {
  return count === 1 ? "Archived" : `Archived ${String(count)} threads`
}

function undoArchive(socket: CommandPort | null, threadIds: readonly string[]): void {
  runPendingAction(pendingActionKey("inbox.unarchive", ...threadIds), async () => {
    for (const threadId of threadIds) await sendCommandWithFeedback(socket, { type: "inbox.unarchive", threadId })
  })
}

export function archiveInboxThreads(
  socket: CommandPort | null,
  threadIds: readonly string[],
  onArchived: () => void,
  toast: InboxToastPort = sonnerInboxToastPort,
): void {
  if (threadIds.length === 0) return
  runPendingAction(archiveActionKey(threadIds), async () => {
    await sendCommandWithFeedback(socket, { type: "inbox.archive", threadIds: [...threadIds] })
    onArchived()
    toast.show({
      title: archivedTitle(threadIds.length),
      actionLabel: "Undo",
      onAction: () => undoArchive(socket, threadIds),
    })
  })
}

export function setInboxThreadsRead(
  socket: CommandPort | null,
  threadIds: readonly string[],
  read: boolean,
  onDone?: () => void,
): void {
  if (threadIds.length === 0) return
  const { selectedThreadId, holdUnread } = useInboxStore.getState()
  if (!read && selectedThreadId !== null && threadIds.includes(selectedThreadId)) holdUnread(selectedThreadId)
  runPendingAction(readActionKey(threadIds, read), async () => {
    const ids = [...threadIds]
    await sendCommandWithFeedback(socket, read ? { type: "inbox.markRead", ids } : { type: "inbox.markUnread", ids })
    onDone?.()
  })
}

export function toggleInboxThreadUnread(socket: CommandPort | null, thread: Pick<InboxThread, "id" | "unread">): void {
  setInboxThreadsRead(socket, [thread.id], thread.unread)
}

export function muteInboxSender(socket: CommandPort | null, threadId: string, muted: boolean): void {
  runPendingAction(pendingActionKey("inbox.muteSender", threadId), async () => {
    await sendCommandWithFeedback(socket, { type: "inbox.muteSender", threadId, muted })
  })
}

export function approveInboxProposal(socket: CommandPort | null, threadId: string, proposalId: string): void {
  runPendingAction(pendingActionKey("inbox.approveProposal", proposalId), async () => {
    await sendCommandWithFeedback(socket, { type: "inbox.approveProposal", threadId, proposalId })
  })
}
