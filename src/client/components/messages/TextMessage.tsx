import { memo } from "react"
import type { ProcessedTextMessage } from "./types"
import { renderMessageMarkdown } from "../lexical/markdown/renderMessage"

interface Props {
  message: ProcessedTextMessage
}

export const TextMessage = memo(({ message }: Props) => {
  return (
    <div className="text-pretty prose prose-sm dark:prose-invert px-0.5 w-full max-w-[70ch] space-y-4">
      {renderMessageMarkdown(message.text)}
    </div>
  )
})
