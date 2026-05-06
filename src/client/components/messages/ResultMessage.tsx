import type { ProcessedResultMessage } from "./types"
import { TurnDurationFooter } from "./TurnDurationFooter"

interface Props {
  message: ProcessedResultMessage
}

export function ResultMessage({ message }: Props) {
  if (!message.success) {
    return (
      <>
        <div className="px-4 py-3 mx-2 my-1 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          {message.result || "An unknown error occurred."}
        </div>
        <TurnDurationFooter durationMs={message.durationMs} prefix="Failed after" />
      </>
    )
  }

  return <TurnDurationFooter durationMs={message.durationMs} />
}
