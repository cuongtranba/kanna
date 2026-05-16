import { memo } from "react"
import Markdown from "react-markdown"
import type { ProcessedTextMessage } from "./types"
import { defaultMarkdownComponents, defaultRemarkPlugins } from "./shared"

interface Props {
  message: ProcessedTextMessage
}

export const TextMessage = memo(function TextMessage({ message }: Props) {
  return (
    <div className="text-pretty prose prose-sm dark:prose-invert px-0.5 w-full max-w-[70ch] space-y-4">
      <Markdown remarkPlugins={defaultRemarkPlugins} components={defaultMarkdownComponents}>{message.text}</Markdown>
    </div>
  )
})
