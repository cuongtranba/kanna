import { useCallback } from "react"
import { Button } from "../components/ui/button"
import { Textarea } from "../components/ui/textarea"
import { HoverHint } from "../components/ui/truncated-text"
import { INBOX_REPLY_MAX_CHARS, type InboxThread } from "../../shared/inbox/types"
import { sendInboxCommand } from "../lib/inboxCommands"
import { NO_CHAT_REPLY_REASON } from "../lib/inboxPresentation"
import { useInboxStore } from "../stores/inboxStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { useOptionalKannaSocket } from "./KannaSocketProvider"

interface Props {
  thread: InboxThread
  onArchived: () => void
}

export function InboxReplyComposer({ thread, onArchived }: Props) {
  const socket = useOptionalKannaSocket()
  const storedDraft = useInboxStore((state) => state.replyDrafts[thread.id])
  const draft = storedDraft ?? thread.report?.draftReply ?? ""
  const hasChat = thread.chatId !== undefined
  const canSubmit = hasChat && draft.trim().length > 0
  const replyKey = pendingActionKey("inbox.reply", thread.id)
  const instructKey = pendingActionKey("inbox.instruct", thread.id)
  const archiveKey = pendingActionKey("inbox.archive", thread.id)
  const replyPending = usePendingAction(replyKey)
  const instructPending = usePendingAction(instructKey)
  const archivePending = usePendingAction(archiveKey)

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      useInboxStore.getState().setReplyDraft(thread.id, event.target.value)
    },
    [thread.id],
  )

  const handleReply = useCallback(() => {
    runPendingAction(replyKey, async () => {
      await sendInboxCommand(socket, { type: "inbox.reply", threadId: thread.id, text: draft })
      useInboxStore.getState().clearReplyDraft(thread.id)
    })
  }, [draft, replyKey, socket, thread.id])

  const handleInstruct = useCallback(() => {
    runPendingAction(instructKey, async () => {
      await sendInboxCommand(socket, { type: "inbox.instruct", threadId: thread.id, text: draft })
      useInboxStore.getState().clearReplyDraft(thread.id)
    })
  }, [draft, instructKey, socket, thread.id])

  const handleDiscard = useCallback(() => {
    useInboxStore.getState().clearReplyDraft(thread.id)
  }, [thread.id])

  const handleArchive = useCallback(() => {
    runPendingAction(archiveKey, async () => {
      await sendInboxCommand(socket, { type: "inbox.archive", threadId: thread.id })
      onArchived()
    })
  }, [archiveKey, onArchived, socket, thread.id])

  return (
    <section aria-label="Reply" className="space-y-2">
      <Textarea
        aria-label="Reply to the sender"
        rows={5}
        maxLength={INBOX_REPLY_MAX_CHARS}
        value={draft}
        onChange={handleChange}
        placeholder="Write a reply, or an instruction for the agent"
        disabled={!hasChat}
      />
      <div className="flex flex-wrap items-center gap-2">
        <HoverHint label={hasChat ? "Send this text to the sender" : NO_CHAT_REPLY_REASON} side="top">
          <span className="inline-flex">
            <Button size="sm" disabled={!canSubmit} pending={replyPending} onClick={handleReply}>
              Send
            </Button>
          </span>
        </HoverHint>
        <HoverHint
          label={hasChat ? "Give the agent this text as an instruction instead of replying to the sender" : NO_CHAT_REPLY_REASON}
          side="top"
        >
          <span className="inline-flex">
            <Button variant="secondary" size="sm" disabled={!canSubmit} pending={instructPending} onClick={handleInstruct}>
              Instruct
            </Button>
          </span>
        </HoverHint>
        <Button variant="ghost" size="sm" disabled={draft.length === 0} onClick={handleDiscard}>
          Discard draft
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          disabled={thread.state === "archived"}
          pending={archivePending}
          onClick={handleArchive}
        >
          Archive
        </Button>
      </div>
      {hasChat ? null : <p className="text-xs text-muted-foreground">{NO_CHAT_REPLY_REASON}</p>}
    </section>
  )
}
