import { memo } from "react"
import type { TranscriptMessageOf } from "../../../shared/types"
import { ThinkingBlock } from "./ThinkingBlock"

interface Props {
  message: TranscriptMessageOf<"assistant_thinking">
}

export const ThinkingMessage = memo(({ message }: Props) => {
  return (
    <div className="px-0.5 w-full max-w-[70ch]">
      <ThinkingBlock content={message.text} />
    </div>
  )
})
