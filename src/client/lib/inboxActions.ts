import type { CommandPort } from "../ports/commandPort"
import { pendingActionKey, runPendingAction } from "../stores/pendingActionsStore"
import { sendCommandWithFeedback } from "./commandFeedback"

export function archiveInboxThread(socket: CommandPort | null, threadId: string, onArchived: () => void): void {
  runPendingAction(pendingActionKey("inbox.archive", threadId), async () => {
    await sendCommandWithFeedback(socket, { type: "inbox.archive", threadId })
    onArchived()
  })
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
