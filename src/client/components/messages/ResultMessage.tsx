import { useCallback } from "react"
import { describeCodexFailure, isRetryableCodexFailure } from "../../../shared/codex-error-classification"
import { TranscriptActionCard, type CardAction } from "../chat-ui/TranscriptActionCard"
import type { ProcessedResultMessage } from "./types"
import { TurnDurationFooter } from "./TurnDurationFooter"
import { renderChatLinks } from "./renderChatLinks"

interface Props {
  message: ProcessedResultMessage
  onRetry?: (resultMessageId: string) => void | Promise<void>
}

interface RetryableFailureCardProps {
  resultMessageId: string
  body: string
  onRetry: (resultMessageId: string) => void | Promise<void>
}

function RetryableFailureCard({ resultMessageId, body, onRetry }: RetryableFailureCardProps) {
  const handleRetry = useCallback(() => onRetry(resultMessageId), [onRetry, resultMessageId])
  const actions: CardAction[] = [
    { id: "retry", label: "Retry", variant: "primary", onClick: handleRetry },
  ]
  return (
    <div className="mx-2 my-1">
      <TranscriptActionCard title="Turn failed" tone="error" body={body} actions={actions} />
    </div>
  )
}

export function ResultMessage({ message, onRetry }: Props) {
  if (!message.success) {
    // Empty `result` text means an earlier transcript entry (api_error /
    // policy_refusal) already rendered the user-facing failure body; this
    // entry only carries the "Failed after Xs" duration footer. Skipping the
    // red body card avoids a duplicate "An unknown error occurred." placeholder
    // (and, on rate-limit turns, a duplicated rate-limit message).
    // Aborted-stream error entries persist with no `result` key, so guard
    // against the field being absent despite the `result: string` type.
    const tag = message.codexErrorInfo
    // A result entry carries no model name; the helper's generic subject reads
    // correctly, so nothing is plumbed down for a cosmetic sentence.
    const body = (tag ? describeCodexFailure(tag, null) : null) ?? message.result ?? ""
    const hasBody = body.trim().length > 0
    const retryable = tag !== undefined && isRetryableCodexFailure(tag)

    let card: React.ReactNode = null
    if (retryable && onRetry) {
      card = <RetryableFailureCard resultMessageId={message.id} body={body} onRetry={onRetry} />
    } else if (hasBody) {
      card = (
        <div className="px-4 py-3 mx-2 my-1 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm whitespace-pre-wrap">
          {renderChatLinks(body)}
        </div>
      )
    }

    return (
      <>
        {card}
        {message.durationMs > 0 ? (
          <TurnDurationFooter durationMs={message.durationMs} prefix="Failed after" />
        ) : null}
      </>
    )
  }

  return <TurnDurationFooter durationMs={message.durationMs} />
}
