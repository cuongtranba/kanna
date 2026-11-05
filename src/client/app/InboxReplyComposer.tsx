import { useCallback } from "react"
import { Button } from "../components/ui/button"
import { Textarea } from "../components/ui/textarea"
import { HoverHint } from "../components/ui/truncated-text"
import { INBOX_REPLY_MAX_CHARS, type InboxThread } from "../../shared/inbox/types"
import { sendCommandWithFeedback } from "../lib/commandFeedback"
import { inboxReplyMode, NO_CHAT_REPLY_REASON, type InboxReplyMode } from "../lib/inboxPresentation"
import { selectMcpSources, useAppSettingsStore } from "../stores/appSettingsStore"
import { useInboxStore } from "../stores/inboxStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { useOptionalKannaSocket } from "./KannaSocketProvider"

interface Props {
  thread: InboxThread
  onArchived: () => void
}

const SEND_LABEL: Readonly<Record<InboxReplyMode, string>> = {
  direct: "Send",
  agent: "Agent will send",
  none: "Send",
}

const SEND_HINT: Readonly<Record<InboxReplyMode, string>> = {
  direct: "Send this text to the sender through the source's reply tool",
  agent: "Hand this text to the handler chat, which sends it to the sender",
  none: NO_CHAT_REPLY_REASON,
}

const INSTRUCT_NEEDS_CHAT_REASON = "Instruct needs a handler chat, and none is handling this source."

const IME_COMPOSITION_KEY_CODE = 229

function isPlainEnter(event: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.nativeEvent.isComposing &&
    event.nativeEvent.keyCode !== IME_COMPOSITION_KEY_CODE
  )
}

export function InboxReplyComposer({ thread, onArchived }: Props) {
  const socket = useOptionalKannaSocket()
  const storedDraft = useInboxStore((state) => state.replyDrafts[thread.id])
  const draft = storedDraft ?? thread.report?.draftReply ?? ""
  const sources = useAppSettingsStore(selectMcpSources)
  const replyMode = inboxReplyMode(thread, sources)
  const hasChat = thread.chatId !== undefined
  const hasText = draft.trim().length > 0
  const canReply = replyMode !== "none" && hasText
  const canInstruct = hasChat && hasText
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
      await sendCommandWithFeedback(socket, { type: "inbox.reply", threadId: thread.id, text: draft })
      useInboxStore.getState().clearReplyDraft(thread.id)
    })
  }, [draft, replyKey, socket, thread.id])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!isPlainEnter(event)) return
      event.preventDefault()
      if (canReply) handleReply()
    },
    [canReply, handleReply],
  )

  const handleInstruct = useCallback(() => {
    runPendingAction(instructKey, async () => {
      await sendCommandWithFeedback(socket, { type: "inbox.instruct", threadId: thread.id, text: draft })
      useInboxStore.getState().clearReplyDraft(thread.id)
    })
  }, [draft, instructKey, socket, thread.id])

  const handleDiscard = useCallback(() => {
    useInboxStore.getState().clearReplyDraft(thread.id)
  }, [thread.id])

  const handleArchive = useCallback(() => {
    runPendingAction(archiveKey, async () => {
      await sendCommandWithFeedback(socket, { type: "inbox.archive", threadId: thread.id })
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
        onKeyDown={handleKeyDown}
        placeholder={hasChat ? "Write a reply, or an instruction for the agent" : "Write a reply"}
        disabled={replyMode === "none"}
      />
      <div className="flex flex-wrap items-center gap-2">
        <HoverHint label={SEND_HINT[replyMode]} side="top">
          <span className="inline-flex">
            <Button size="sm" disabled={!canReply} pending={replyPending} onClick={handleReply}>
              {SEND_LABEL[replyMode]}
            </Button>
          </span>
        </HoverHint>
        <HoverHint
          label={hasChat ? "Give the agent this text as an instruction instead of replying to the sender" : INSTRUCT_NEEDS_CHAT_REASON}
          side="top"
        >
          <span className="inline-flex">
            <Button variant="secondary" size="sm" disabled={!canInstruct} pending={instructPending} onClick={handleInstruct}>
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
      {replyMode === "none" ? <p className="text-xs text-muted-foreground">{NO_CHAT_REPLY_REASON}</p> : null}
    </section>
  )
}
