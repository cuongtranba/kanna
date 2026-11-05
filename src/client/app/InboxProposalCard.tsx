import { useCallback } from "react"
import type { InboxProposal, InboxThread } from "../../shared/inbox/types"
import { Button } from "../components/ui/button"
import { useNow } from "../hooks/useNow"
import { sendCommandWithFeedback } from "../lib/commandFeedback"
import { approveInboxProposal } from "../lib/inboxActions"
import { confidencePercent, formatCountdown } from "../lib/inboxAutonomy"
import { useInboxStore } from "../stores/inboxStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { useOptionalKannaSocket } from "./KannaSocketProvider"

interface CardProps {
  threadId: string
  proposal: InboxProposal
}

function ProposalBody({ proposal }: { proposal: InboxProposal }) {
  return (
    <>
      <p className="whitespace-pre-wrap break-words text-sm text-foreground">{proposal.text}</p>
      <p className="text-xs text-muted-foreground">
        <span className="tabular-nums">Confidence {confidencePercent(proposal.confidence)}</span>
        {proposal.reason.length > 0 ? <span> · {proposal.reason}</span> : null}
      </p>
    </>
  )
}

function OpenProposal({ threadId, proposal }: CardProps) {
  const socket = useOptionalKannaSocket()
  const sendKey = pendingActionKey("inbox.approveProposal", proposal.id)
  const rejectKey = pendingActionKey("inbox.rejectProposal", proposal.id)
  const sending = usePendingAction(sendKey)
  const rejecting = usePendingAction(rejectKey)

  const handleSend = useCallback(() => approveInboxProposal(socket, threadId, proposal.id), [proposal.id, socket, threadId])
  const handleEdit = useCallback(() => useInboxStore.getState().setReplyDraft(threadId, proposal.text), [proposal.text, threadId])
  const handleReject = useCallback(() => {
    runPendingAction(rejectKey, async () => {
      await sendCommandWithFeedback(socket, { type: "inbox.rejectProposal", threadId, proposalId: proposal.id })
    })
  }, [proposal.id, rejectKey, socket, threadId])

  return (
    <section aria-label="Agent proposal" className="space-y-2 rounded-lg border border-border bg-muted px-3 py-3">
      <h3 className="text-sm font-semibold text-foreground">Agent proposes this reply</h3>
      <ProposalBody proposal={proposal} />
      {proposal.blockedBy === undefined ? null : (
        <p className="text-xs text-warning-text">Needs your OK: {proposal.blockedBy}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" pending={sending} disabled={rejecting} onClick={handleSend}>
          Send
        </Button>
        <Button variant="secondary" size="sm" disabled={sending || rejecting} onClick={handleEdit}>
          Edit
        </Button>
        <Button variant="ghost" size="sm" pending={rejecting} disabled={sending} onClick={handleReject}>
          Reject
        </Button>
      </div>
    </section>
  )
}

function ScheduledProposal({ threadId, proposal }: CardProps) {
  const socket = useOptionalKannaSocket()
  const now = useNow(1_000)
  const undoKey = pendingActionKey("inbox.cancelProposal", proposal.id)
  const undoing = usePendingAction(undoKey)
  const remaining = (proposal.scheduledFor ?? now) - now

  const handleUndo = useCallback(() => {
    runPendingAction(undoKey, async () => {
      await sendCommandWithFeedback(socket, { type: "inbox.cancelProposal", threadId, proposalId: proposal.id })
    })
  }, [proposal.id, socket, threadId, undoKey])

  return (
    <section aria-label="Agent auto-send" className="space-y-2 rounded-lg border border-border bg-muted px-3 py-3">
      <h3 className="text-sm font-semibold text-foreground tabular-nums">Sending in {formatCountdown(remaining)}</h3>
      <ProposalBody proposal={proposal} />
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" pending={undoing} onClick={handleUndo}>
          Undo
        </Button>
      </div>
    </section>
  )
}

export function InboxProposalCard({ thread }: { thread: InboxThread }) {
  const { proposal } = thread
  if (proposal === undefined) return null
  return proposal.status === "scheduled" ? (
    <ScheduledProposal threadId={thread.id} proposal={proposal} />
  ) : (
    <OpenProposal threadId={thread.id} proposal={proposal} />
  )
}
