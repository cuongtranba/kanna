import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { QueuedChatMessage } from "../../../shared/types"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip"
import { createMarkdownComponents } from "./shared"

interface QueuedUserMessageProps {
  message: QueuedChatMessage
  onSendNow: () => void
}

export function QueuedUserMessage({ message, onSendNow }: QueuedUserMessageProps) {
  return (
    <div className="flex justify-end py-2">
      <TooltipProvider delayDuration={120}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onSendNow}
              className="flex max-w-[85%] sm:max-w-[80%] cursor-pointer flex-col items-end gap-2 text-right"
            >
              {message.attachments.length > 0 ? (
                <div className="flex flex-wrap justify-end gap-2">
                  {message.attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="max-w-[220px] rounded-xl border border-dotted border-border bg-transparent px-3 py-2 text-left"
                    >
                      <div className="truncate text-[13px] font-medium text-foreground">{attachment.displayName}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{attachment.mimeType}</div>
                    </div>
                  ))}
                </div>
              ) : null}
              {message.content ? (
                <div className="rounded-[20px] border border-dotted border-border bg-transparent px-3.5 py-1.5 prose prose-sm prose-invert text-primary [&_p]:whitespace-pre-line">
                  <Markdown remarkPlugins={[remarkGfm]} components={createMarkdownComponents()}>{message.content}</Markdown>
                </div>
              ) : null}
            </button>
          </TooltipTrigger>
          <TooltipContent>click to send now</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}
