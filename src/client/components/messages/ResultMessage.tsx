import type { ProcessedResultMessage } from "./types"
import { TurnDurationFooter } from "./TurnDurationFooter"
import { renderChatLinks } from "./renderChatLinks"

interface Props {
  message: ProcessedResultMessage
}

export function ResultMessage({ message }: Props) {
  if (!message.success) {
    // Empty `result` text means an earlier transcript entry (api_error /
    // policy_refusal) already rendered the user-facing failure body; this
    // entry only carries the "Failed after Xs" duration footer. Skipping the
    // red body card avoids a duplicate "An unknown error occurred." placeholder
    // (and, on rate-limit turns, a duplicated rate-limit message).
    // Aborted-stream error entries persist with no `result` key, so guard
    // against the field being absent despite the `result: string` type.
    const body = message.result ?? ""
    const hasBody = body.trim().length > 0
    return (
      <>
        {hasBody ? (
          <div className="px-4 py-3 mx-2 my-1 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm whitespace-pre-wrap">
            {renderChatLinks(body)}
          </div>
        ) : null}
        {message.durationMs > 0 ? (
          <TurnDurationFooter durationMs={message.durationMs} prefix="Failed after" />
        ) : null}
      </>
    )
  }

  return <TurnDurationFooter durationMs={message.durationMs} />
}
