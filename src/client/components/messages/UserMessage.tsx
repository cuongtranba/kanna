import { memo, useMemo } from "react"
import type { ChatAttachment } from "../../../shared/types"
import { renderMarkdownToReact } from "../lexical/markdown/lexicalToReact"
import { classifyAttachmentPreview } from "./attachmentPreview"
import { AttachmentFileCard, AttachmentImageCard } from "./AttachmentCard"
import { FilePreviewSheet } from "./file-preview/FilePreviewSheet"
import { toPreviewSourceFromAttachment, type PreviewSource } from "./file-preview/types"
import { Zap } from "lucide-react"
import { useTranscriptRenderOptions } from "./render-context"
import { UserMessageStore } from "./UserMessage.store"
import type { DomPort } from "../../ports/domPort"
import { domAdapter } from "../../adapters/dom.adapter"

export interface UserMessagePorts {
  dom?: DomPort
}

interface Props {
  content: string
  attachments?: ChatAttachment[]
  steered?: boolean
  autoContinue?: { scheduleId: string }
  ports?: UserMessagePorts
}

function parseSystemMessage(content: string) {
  const match = content.match(/^<system-message>\s*([\s\S]*?)\s*<\/system-message>\s*([\s\S]*)$/)
  if (!match) {
    return { systemMessage: null, body: content }
  }

  return {
    systemMessage: match[1]?.trim() || null,
    body: match[2] ?? "",
  }
}

function UserMessageInner({ content, attachments = [], steered = false, autoContinue, ports }: Props) {
  const dom = ports?.dom ?? domAdapter
  const selectedAttachmentId = UserMessageStore.useScopedStore((s) => s.selectedAttachmentId)
  const setSelectedAttachmentId = UserMessageStore.useScopedStore((s) => s.setSelectedAttachmentId)
  const renderOptions = useTranscriptRenderOptions()
  const parsedContent = useMemo(() => parseSystemMessage(content), [content])
  const canInteractWithAttachments = !renderOptions.readonly
  const imageAttachments = useMemo(
    () => attachments.filter((attachment) => attachment.kind === "image" && attachment.contentUrl),
    [attachments],
  )
  const fileAttachments = useMemo(
    () => attachments.filter((attachment) => attachment.kind !== "image" || !attachment.contentUrl),
    [attachments],
  )
  const selectedAttachment = attachments.find((attachment) => attachment.id === selectedAttachmentId) ?? null
  const selectedSource: PreviewSource | null = selectedAttachment
    ? toPreviewSourceFromAttachment(selectedAttachment, "user_attachment")
    : null

  function handleAttachmentClick(attachment: ChatAttachment) {
    if (!canInteractWithAttachments || !attachment.contentUrl) {
      return
    }

    const target = classifyAttachmentPreview(attachment)
    if (target.openInNewTab) {
      dom.openWindow(new URL(attachment.contentUrl, dom.getBaseURI() || dom.getHref()).toString(), "_blank", "noopener,noreferrer")
      return
    }

    setSelectedAttachmentId(attachment.id)
  }

  return (
    <>
      <div className="flex flex-col items-start gap-2">
        {imageAttachments.length > 0 ? (
          <div className="flex max-w-[85%] flex-wrap gap-3 sm:max-w-[80%]">
            {imageAttachments.map((attachment) => (
              <AttachmentImageCard
                key={attachment.id}
                attachment={attachment}
                onClick={canInteractWithAttachments ? () => handleAttachmentClick(attachment) : undefined}
              />
            ))}
          </div>
        ) : null}
        {fileAttachments.length > 0 ? (
          <div className="flex max-w-[85%] flex-wrap gap-2 sm:max-w-[80%]">
            {fileAttachments.map((attachment) => (
              <AttachmentFileCard
                key={attachment.id}
                attachment={attachment}
                onClick={canInteractWithAttachments ? () => handleAttachmentClick(attachment) : undefined}
              />
            ))}
          </div>
        ) : null}
        {(parsedContent.body || (!parsedContent.body && attachments.length === 0 && content && !parsedContent.systemMessage)) ? (
          <div className="flex w-full flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
            {/* The speaker is set in the margin, as a manuscript gloss. The
                bubble it replaces was the last card on this surface: a box,
                a radius, a fill, and a right-hand alignment all its own, so
                the user's own words were the one thing that did not sit on
                the rail everything else is measured from. */}
            <span
              aria-hidden
              className="shrink-0 select-none font-mono text-xs tracking-wide text-muted-foreground sm:w-12 sm:pt-0.5 sm:text-right"
            >
              You
            </span>
            {steered ? (
              <Zap
                aria-label="Sent mid-turn"
                className="mt-1 size-3.5 shrink-0 text-muted-foreground"
              />
            ) : null}
            <div className="min-w-0 flex-1 text-foreground prose prose-sm dark:prose-invert [&_p]:whitespace-pre-line">
              {renderMarkdownToReact(parsedContent.body)}
            </div>
          </div>
        ) : null}
        {autoContinue ? (
          <span className="text-xs text-muted-foreground opacity-70">auto-sent</span>
        ) : null}
      </div>
      <FilePreviewSheet
        source={selectedSource}
        open={selectedSource !== null}
        onOpenChange={(open) => !open && setSelectedAttachmentId(null)}
      />
    </>
  )
}

export const UserMessage = memo(({ content, attachments = [], steered = false, autoContinue, ports }: Props) => {
  return (
    <UserMessageStore.Provider init={undefined}>
      <UserMessageInner content={content} attachments={attachments} steered={steered} autoContinue={autoContinue} ports={ports} />
    </UserMessageStore.Provider>
  )
})
