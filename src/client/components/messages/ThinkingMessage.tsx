import { memo } from "react"
import type { ProcessedThinkingMessage } from "./types"
import { ThinkingBlock } from "./ThinkingBlock"

interface Props {
  message: ProcessedThinkingMessage
}

// Renders a structured `assistant_thinking` transcript entry (Claude's
// extended-reasoning content block) collapsed by default, reusing the same
// disclosure UI as inline `<thinking>` segments in assistant text.
export const ThinkingMessage = memo(function ThinkingMessage({ message }: Props) {
  return (
    <div className="px-0.5 w-full max-w-[70ch]">
      <ThinkingBlock content={message.text} />
    </div>
  )
})
