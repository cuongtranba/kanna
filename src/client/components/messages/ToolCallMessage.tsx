import { X } from "lucide-react"
import { isRecord } from "../../../shared/errors"
import type { HydratedToolCall, ReadFileImageBlock } from "../../../shared/types"
import { MetaRow, MetaLabel, MetaCodeBlock, ExpandableRow, VerticalLineContainer, LucideIconWrapper } from "./shared"
import { useMemo, type ReactNode } from "react"
import { useShallow } from "zustand/react/shallow"
import { AnimatedShinyText } from "../ui/animated-shiny-text"
import { toolIcon, toolTitle } from "../../lib/toolPresentation"
import { FileContentView } from "./FileContentView"
import { ImageViewMessage } from "./ImageViewMessage"
import { WorkflowMessage } from "./WorkflowMessage"
import { SubagentTaskMessage } from "./SubagentTaskMessage"
import { useWorkflowsStore, selectRuns } from "../../stores/workflowsStore"

interface Props {
  message: HydratedToolCall
  isLoading?: boolean
  localPath?: string | null
  chatId?: string
}

export function ReadResultImages({ images }: { images: ReadonlyArray<ReadFileImageBlock> }) {
  return (
    <div className="flex flex-col gap-3">
      {images.map((image, index) => {
        const mimeType = image.mimeType || "image/png"
        return (
          <div key={`${mimeType}:${index}`} className="overflow-hidden rounded-lg border border-border bg-muted/20">
            <img
              src={`data:${mimeType};base64,${image.data}`}
              alt={`Read result ${index + 1}`}
              className="max-h-[50vh] w-full object-contain bg-background"
            />
          </div>
        )
      })}
    </div>
  )
}

function isImageBlock(block: { type: string }): block is ReadFileImageBlock {
  return block.type === "image"
}

function ReadResultBody({ result, resultText }: { result: Extract<HydratedToolCall, { toolKind: "read_file" }>["result"]; resultText: string }) {
  const images = typeof result === "object" ? (result.blocks ?? []).filter(isImageBlock) : []
  if (images.length === 0) return <FileContentView content={resultText} />
  return (
    <div>
      <span className="font-medium text-muted-foreground">Image</span>
      <div className="mt-1">
        <ReadResultImages images={images} />
      </div>
    </div>
  )
}

function bashInputLabel(input: Extract<HydratedToolCall, { toolKind: "bash" }>["input"]): ReactNode {
  return (
    <span className="flex items-center gap-2 w-full">
      <span>Command</span>
      {Boolean(input.timeoutMs) && (
        <span className="text-muted-foreground">timeout: {String(input.timeoutMs)}ms</span>
      )}
      {Boolean(input.runInBackground) && (
        <span className="text-muted-foreground">background</span>
      )}
    </span>
  )
}

function inputView(message: HydratedToolCall): ReactNode {
  switch (message.toolKind) {
    case "edit_file":
      return <FileContentView content="" isDiff oldString={message.input.oldString} newString={message.input.newString} />
    case "delete_file":
      return <FileContentView content={message.input.content} />
    case "read_file":
    case "write_file":
    case "image_view":
      return null
    case "bash":
      return (
        <MetaCodeBlock label={bashInputLabel(message.input)} copyText={message.input.command}>
          {message.input.command}
        </MetaCodeBlock>
      )
    default: {
      const inputText = JSON.stringify(message.input, null, 2)
      return (
        <MetaCodeBlock label="Input" copyText={inputText}>
          {inputText}
        </MetaCodeBlock>
      )
    }
  }
}

function resultView(message: HydratedToolCall, resultText: string): ReactNode {
  const hasResult = message.result !== undefined
  const succeeded = !message.isError
  const generic = hasResult ? (
    <MetaCodeBlock label={succeeded ? "Result" : "Error"} copyText={resultText}>
      {resultText}
    </MetaCodeBlock>
  ) : null

  switch (message.toolKind) {
    case "read_file":
      return hasResult && succeeded ? <ReadResultBody result={message.result} resultText={resultText} /> : null
    case "image_view":
      return succeeded
        ? (
          <ImageViewMessage
            toolId={message.toolId}
            path={message.input.path}
            contentUrl={message.input.contentUrl}
            mimeType={message.input.mimeType}
          />
        )
        : generic
    case "write_file":
      return succeeded ? <FileContentView content={message.input.content} /> : generic
    case "edit_file":
    case "delete_file":
      return succeeded ? null : generic
    default:
      return generic
  }
}

export function ToolCallMessage({ message, isLoading = false, localPath, chatId = "" }: Props) {
  const hasResult = message.result !== undefined
  const showLoadingState = !hasResult && isLoading

  const workflowRuns = useWorkflowsStore(useShallow(selectRuns(chatId)))

  const label = useMemo(() => toolTitle(message, localPath), [message, localPath])

  const resultText = useMemo(() => {
    if (typeof message.result === "string") return message.result
    if (!message.result) return ""
    if (isRecord(message.result)) {
      const content = message.result.content
      if (typeof content === "string") return content
    }
    return JSON.stringify(message.result, null, 2)
  }, [message.result])

  let toolContent: ReactNode
  if (message.toolKind === "workflow" && !message.isError) {
    const taskId = message.result?.taskId
    const run = taskId ? workflowRuns.find((r) => r.taskId === taskId) : undefined
    toolContent = (
      <WorkflowMessage
        name={message.input.name}
        description={message.input.description}
        run={run}
      />
    )
  } else if (message.toolKind === "subagent_task" && message.result) {
    toolContent = (
      <SubagentTaskMessage
        subagentType={message.input.subagentType}
        result={message.result}
        isError={message.isError}
        localPath={localPath}
      />
    )
  } else {
    toolContent = (
      <>
        <div className={`w-5 h-5 relative flex items-center justify-center`}>
          {message.isError
            ? <X className="size-4 text-destructive" />
            : <LucideIconWrapper icon={toolIcon(message)} className="size-4 text-muted-icon" />}
        </div>
        <MetaLabel className="text-left transition-opacity duration-200 truncate">
          <AnimatedShinyText animate={showLoadingState}>
            {label}
          </AnimatedShinyText>
        </MetaLabel>
      </>
    )
  }

  return (
    <MetaRow className="w-full">
      <ExpandableRow
        expandedContent={
          <VerticalLineContainer className="my-4 text-sm">
            <div className="flex flex-col gap-2">
              {inputView(message)}
              {resultView(message, resultText)}
            </div>
          </VerticalLineContainer>
        }
      >

        {toolContent}



      </ExpandableRow>
    </MetaRow>
  )
}
