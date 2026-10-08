import { useMemo } from "react"
import { Brain } from "lucide-react"
import type { LiveBlock } from "../../../shared/live-block"
import { selectLiveBlock, useLiveBlockStore } from "../../stores/liveBlockStore"
import { formatByteSize } from "../../lib/formatByteSize"
import { renderMessageMarkdown } from "../lexical/markdown/renderMessage"
import { renderMarkdownToReact } from "../lexical/markdown/lexicalToReact"
import { AnimatedShinyText } from "../ui/animated-shiny-text"
import { Spinner } from "../ui/spinner"
import { TruncatedText } from "../ui/truncated-text"
import { ProcessingMessage } from "./ProcessingMessage"
import { LucideIconWrapper, MetaContent, MetaLabel, MetaRow, getToolIcon } from "./shared"

type LiveTextBlock = Extract<LiveBlock, { kind: "text" }>
type LiveThinkingBlock = Extract<LiveBlock, { kind: "thinking" }>
type LiveToolUseBlock = Extract<LiveBlock, { kind: "tool_use" }>

function LiveText({ block }: { block: LiveTextBlock }) {
  const rendered = useMemo(() => renderMessageMarkdown(block.text), [block.text])
  return (
    <div
      data-testid="live-block-text"
      className="text-pretty prose prose-sm dark:prose-invert px-0.5 w-full max-w-[70ch] space-y-4"
    >
      {rendered}
    </div>
  )
}

function LiveThinking({ block }: { block: LiveThinkingBlock }) {
  const trimmed = block.text.trim()
  const rendered = useMemo(() => renderMarkdownToReact(trimmed), [trimmed])
  return (
    <div data-testid="live-block-thinking" className="px-0.5 w-full max-w-[70ch]">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Brain className="h-3.5 w-3.5" />
        <AnimatedShinyText className="ml-0 font-medium tracking-wider" shimmerWidth={44}>
          Thinking…
        </AnimatedShinyText>
      </div>
      {trimmed.length > 0 ? (
        <div className="mt-2 flex max-h-56 flex-col justify-end overflow-hidden border-l-2 border-muted-foreground/20 pl-3 text-sm text-muted-foreground italic prose prose-sm dark:prose-invert max-w-[70ch]">
          <div>{rendered}</div>
        </div>
      ) : null}
    </div>
  )
}

function LiveToolUse({ block }: { block: LiveToolUseBlock }) {
  return (
    <MetaRow className="ml-[1px] w-full">
      <MetaContent className="min-w-0 flex-1 gap-2 text-sm">
        <Spinner className="size-4.5 text-muted-icon" />
        <LucideIconWrapper icon={getToolIcon(block.toolName)} className="size-4 shrink-0 text-muted-icon" />
        <MetaLabel className="shrink-0">
          <AnimatedShinyText shimmerWidth={44}>{block.toolName}</AnimatedShinyText>
        </MetaLabel>
        {block.subject ? (
          <TruncatedText tooltip={block.subject} inline className="min-w-0 text-muted-foreground">
            {block.subject}
          </TruncatedText>
        ) : null}
        {block.inputChars > 0 ? (
          <span data-testid="live-block-size" className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatByteSize(block.inputChars)}
          </span>
        ) : null}
      </MetaContent>
    </MetaRow>
  )
}

interface LiveTurnIndicatorProps {
  chatId: string | null
  status?: string
}

export function LiveTurnIndicator({ chatId, status }: LiveTurnIndicatorProps) {
  const block = useLiveBlockStore(selectLiveBlock(chatId))
  if (block === null) return <ProcessingMessage status={status} />
  if (block.kind === "text") return <LiveText block={block} />
  if (block.kind === "thinking") return <LiveThinking block={block} />
  return <LiveToolUse block={block} />
}
