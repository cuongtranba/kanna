import { useCallback } from "react"
import { outboundRetryState } from "../../shared/inbox/policy"
import type { InboxOutboundMessage, InboxThread } from "../../shared/inbox/types"
import { Button } from "../components/ui/button"
import { StateMarkLabel } from "../components/ui/state-mark"
import { HoverHint } from "../components/ui/truncated-text"
import { sendCommandWithFeedback } from "../lib/commandFeedback"
import { formatStartedClock } from "../lib/formatters"
import { outboundAuthorLabel, outboundProvenanceHint } from "../lib/inboxAutonomy"
import { outboundStatusDisplay } from "../lib/inboxPresentation"
import { useInboxStore } from "../stores/inboxStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { useOptionalKannaSocket } from "./KannaSocketProvider"

interface Props {
  thread: InboxThread
  outbound: InboxOutboundMessage
}

function AuthorLabel({ outbound }: { outbound: InboxOutboundMessage }) {
  const label = <span className="font-medium">{outboundAuthorLabel(outbound)}</span>
  const hint = outboundProvenanceHint(outbound)
  return hint === null ? label : <HoverHint label={hint} side="top">{label}</HoverHint>
}

export function InboxOutboundEntry({ thread, outbound }: Props) {
  const socket = useOptionalKannaSocket()
  const confirming = useInboxStore((state) => state.retryConfirming[outbound.id] === true)
  const retryKey = pendingActionKey("inbox.retrySend", outbound.id)
  const retrying = usePendingAction(retryKey)
  const display = outboundStatusDisplay(outbound)
  const retryState = outboundRetryState(thread, outbound.id)
  const needsConfirm = retryState.kind === "needs_confirm"
  const threadId = thread.id

  const sendAgain = useCallback(
    (confirmDuplicate: boolean) => {
      runPendingAction(retryKey, async () => {
        await sendCommandWithFeedback(socket, {
          type: "inbox.retrySend",
          threadId,
          outboundId: outbound.id,
          ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
        })
        useInboxStore.getState().dismissRetryConfirm(outbound.id)
      })
    },
    [outbound.id, retryKey, socket, threadId],
  )
  const handleRetry = useCallback(() => {
    if (needsConfirm) useInboxStore.getState().askRetryConfirm(outbound.id)
    else sendAgain(false)
  }, [needsConfirm, outbound.id, sendAgain])
  const handleConfirm = useCallback(() => sendAgain(true), [sendAgain])
  const handleCancel = useCallback(() => useInboxStore.getState().dismissRetryConfirm(outbound.id), [outbound.id])

  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 whitespace-pre-wrap break-words text-sm text-foreground">
          <AuthorLabel outbound={outbound} />
          <span className="text-muted-foreground"> · </span>
          {outbound.text}
        </p>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{formatStartedClock(outbound.ts)}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <StateMarkLabel tone={display.tone} label={display.label} className="min-w-0 break-words" />
        {retryState.kind !== "refused" && !confirming ? (
          <Button variant="link" size="none" className="h-auto text-xs" pending={retrying} onClick={handleRetry}>
            Retry
          </Button>
        ) : null}
      </div>
      {confirming ? (
        <div role="alert" className="mt-2 space-y-2 rounded-lg border border-border bg-muted px-3 py-2">
          <p className="text-xs text-foreground">
            The first attempt may already have been delivered. Sending again may deliver this message twice.
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" pending={retrying} onClick={handleConfirm}>
              Send again
            </Button>
            <Button variant="ghost" size="sm" disabled={retrying} onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  )
}
