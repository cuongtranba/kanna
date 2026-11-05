import { useCallback, useEffect, useRef } from "react"
import { Button } from "../components/ui/button"
import { Textarea } from "../components/ui/textarea"
import { HoverHint } from "../components/ui/truncated-text"
import type { InboxQuickPrompt } from "../../shared/inbox/quick-prompts"
import { INBOX_REPLY_MAX_CHARS, type InboxThread } from "../../shared/inbox/types"
import { sendCommandWithFeedback } from "../lib/commandFeedback"
import { archiveInboxThread } from "../lib/inboxActions"
import { inboxAskBlockedReason, inboxReplyMode, NO_CHAT_REPLY_REASON, type InboxReplyMode } from "../lib/inboxPresentation"
import { selectMcpSources, useAppSettingsStore } from "../stores/appSettingsStore"
import { displayedReplyDraft, useInboxStore } from "../stores/inboxStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { DraftChips, QuickPrompts } from "./InboxAskControls"
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

const ASK_HINT = "Ask the agent to write a draft from this text; nothing is sent to the sender"
const SLASH_PREFIX = "/"

function instructionOf(draft: string): string {
  const text = draft.startsWith(SLASH_PREFIX) ? draft.slice(SLASH_PREFIX.length) : draft
  return text.trim()
}

const IME_COMPOSITION_KEY_CODE = 229

function isEnter(event: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.nativeEvent.isComposing &&
    event.nativeEvent.keyCode !== IME_COMPOSITION_KEY_CODE
  )
}

function isModifiedEnter(event: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
  return isEnter(event) && (event.metaKey || event.ctrlKey)
}

function isPlainEnter(event: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
  return isEnter(event) && !event.metaKey && !event.ctrlKey
}

export function InboxReplyComposer({ thread, onArchived }: Props) {
  const socket = useOptionalKannaSocket()
  const storedDraft = useInboxStore((state) => state.replyDrafts[thread.id])
  const draft = displayedReplyDraft(storedDraft, thread.drafts)
  const latestDraftId = thread.drafts.at(-1)?.id
  const sources = useAppSettingsStore(selectMcpSources)
  const replyMode = inboxReplyMode(thread, sources)
  const askBlockedReason = inboxAskBlockedReason(thread)
  const canAsk = askBlockedReason === null
  const hasChat = thread.chatId !== undefined
  const hasText = draft.trim().length > 0
  const canReply = replyMode !== "none" && hasText
  const replyKey = pendingActionKey("inbox.reply", thread.id)
  const askKey = pendingActionKey("inbox.instruct", thread.id)
  const archiveKey = pendingActionKey("inbox.archive", thread.id)
  const replyPending = usePendingAction(replyKey)
  const askPending = usePendingAction(askKey)
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
      useInboxStore.getState().settleReplyDraft(thread.id, latestDraftId)
    })
  }, [draft, latestDraftId, replyKey, socket, thread.id])

  const ask = useCallback(
    (instruction: string, currentDraft: string | undefined) => {
      runPendingAction(askKey, async () => {
        await sendCommandWithFeedback(socket, {
          type: "inbox.instruct",
          threadId: thread.id,
          text: instruction,
          ...(currentDraft === undefined ? {} : { draft: currentDraft }),
        })
        useInboxStore.getState().settleReplyDraft(thread.id, latestDraftId)
      })
    },
    [askKey, latestDraftId, socket, thread.id],
  )

  const handleAsk = useCallback(() => {
    const instruction = instructionOf(draft)
    if (canAsk && instruction.length > 0) ask(instruction, undefined)
  }, [ask, canAsk, draft])

  const handleQuickPrompt = useCallback(
    (prompt: InboxQuickPrompt) => {
      const current = draft.trim()
      ask(prompt.instruction, current.length > 0 ? current : undefined)
    },
    [ask, draft],
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (isModifiedEnter(event)) {
        event.preventDefault()
        handleAsk()
        return
      }
      if (!isPlainEnter(event)) return
      event.preventDefault()
      if (canAsk && draft.startsWith(SLASH_PREFIX)) {
        handleAsk()
        return
      }
      if (canReply) handleReply()
    },
    [canAsk, canReply, draft, handleAsk, handleReply],
  )

  const handleDiscard = useCallback(() => {
    useInboxStore.getState().settleReplyDraft(thread.id, latestDraftId)
  }, [latestDraftId, thread.id])

  const handleArchive = useCallback(() => archiveInboxThread(socket, thread.id, onArchived), [onArchived, socket, thread.id])

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(
    () => useInboxStore.getState().registerComposerFocus(() => textareaRef.current?.focus()),
    [],
  )

  return (
    <section aria-label="Reply" className="space-y-2">
      <DraftChips threadId={thread.id} drafts={thread.drafts} currentText={draft} />
      <Textarea
        ref={textareaRef}
        aria-label="Reply to the sender"
        rows={5}
        maxLength={INBOX_REPLY_MAX_CHARS}
        value={draft}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={hasChat ? "Write a reply, or ask the agent (⌘↵, or start with /)" : "Write a reply"}
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
        <HoverHint label={askBlockedReason ?? ASK_HINT} side="top">
          <span className="inline-flex">
            <Button variant="secondary" size="sm" disabled={!canAsk || !hasText} pending={askPending} onClick={handleAsk}>
              Ask agent
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
      <QuickPrompts disabled={!canAsk || askPending} onAsk={handleQuickPrompt} />
      {replyMode === "none" ? <p className="text-xs text-muted-foreground">{NO_CHAT_REPLY_REASON}</p> : null}
    </section>
  )
}
