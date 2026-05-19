import type { ProcessedResultMessage } from "./types"
import { TurnDurationFooter } from "./TurnDurationFooter"
import { renderChatLinks } from "./renderChatLinks"

interface Props {
  message: ProcessedResultMessage
}

export function ResultMessage({ message }: Props) {
  if (!message.success) {
    const body = message.result || "An unknown error occurred."
    return (
      <>
        <div className="px-4 py-3 mx-2 my-1 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm whitespace-pre-wrap">
          {renderChatLinks(body)}
        </div>
        {message.durationMs > 0 ? (
          <TurnDurationFooter durationMs={message.durationMs} prefix="Failed after" />
        ) : null}
      </>
    )
  }

  return <TurnDurationFooter durationMs={message.durationMs} />
}
