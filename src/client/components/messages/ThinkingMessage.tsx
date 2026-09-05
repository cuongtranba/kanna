import { memo } from "react"
import type { ProcessedThinkingMessage } from "./types"
import { ThinkingBlock } from "./ThinkingBlock"

interface Props {
  message: ProcessedThinkingMessage
}

export const ThinkingMessage = memo(({ message }: Props) => {
  return (
    <div className="px-0.5 w-full max-w-[70ch]">
      <ThinkingBlock content={message.text} />
    </div>
  )
})
