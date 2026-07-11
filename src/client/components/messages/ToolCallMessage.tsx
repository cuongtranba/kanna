import { GitBranch, UserRound, X } from "lucide-react"
import type { AnyValue } from "../../../shared/errors"
import { isRecord } from "../../../shared/errors"
import type { ProcessedToolCall } from "./types"
import { MetaRow, MetaLabel, MetaCodeBlock, ExpandableRow, VerticalLineContainer, getToolIcon, LucideIconWrapper } from "./shared"
import { useMemo, type ReactNode } from "react"
import { useShallow } from "zustand/react/shallow"
import { stripWorkspacePath } from "../../lib/pathUtils"
import { AnimatedShinyText } from "../ui/animated-shiny-text"
import { formatBashCommandTitle, toTitleCase } from "../../lib/formatters"
import { FileContentView } from "./FileContentView"
import { WorkflowMessage } from "./WorkflowMessage"
import { SubagentTaskMessage } from "./SubagentTaskMessage"
import { useWorkflowsStore, selectRuns } from "../../stores/workflowsStore"
import type { WorkflowToolResult } from "../../../shared/types"

interface Props {
  message: ProcessedToolCall
  isLoading?: boolean
  localPath?: string | null
  chatId?: string
}

type ReadImageBlock = {
  type: "image"
  data: string
  mimeType?: string
}

function extractReadImageBlocks(value: AnyValue): ReadImageBlock[] {
  let blocks: AnyValue[]
  if (isRecord(value) && Array.isArray(value.content)) {
    blocks = value.content
  } else if (Array.isArray(value)) {
    blocks = value
  } else {
    blocks = []
  }

  return blocks.flatMap((block) => {
    if (!block || typeof block !== "object" || !("type" in block) || block.type !== "image") {
      return []
    }

    if ("data" in block && typeof block.data === "string") {
      return [{
        type: "image",
        data: block.data,
        mimeType: "mimeType" in block && typeof block.mimeType === "string" ? block.mimeType : undefined,
      } satisfies ReadImageBlock]
    }

    if (
      "source" in block
      && block.source
      && typeof block.source === "object"
      && "type" in block.source
      && block.source.type === "base64"
      && "data" in block.source
      && typeof block.source.data === "string"
    ) {
      return [{
        type: "image",
        data: block.source.data,
        mimeType: "media_type" in block.source && typeof block.source.media_type === "string" ? block.source.media_type : undefined,
      } satisfies ReadImageBlock]
    }

    return []
  })
}

export function ReadResultImages({ images }: { images: ReadonlyArray<ReadImageBlock> }) {
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

export function ToolCallMessage({ message, isLoading = false, localPath, chatId = "" }: Props) {
  const hasResult = message.result !== undefined
  const showLoadingState = !hasResult && isLoading

  // Must be called unconditionally at the top — Rules of Hooks
  const workflowRuns = useWorkflowsStore(useShallow(selectRuns(chatId)))

  const name = useMemo(() => {
    if (message.toolKind === "skill") {
      return message.input.skill
    }
    if (message.toolKind === "glob") {
      return `Search files ${message.input.pattern === "**/*" ? "in all directories" : `matching ${message.input.pattern}`}`
    }
    if (message.toolKind === "grep") {
      const pattern = message.input.pattern
      const outputMode = message.input.outputMode
      if (outputMode === "count") {
        return `Count \`${pattern}\` occurrences`
      }
      if (outputMode === "content") {
        return `Find \`${pattern}\` in text`
      }
      return `Find \`${pattern}\` in files`
    }
    if (message.toolKind === "bash") {
      return message.input.description || (message.input.command ? formatBashCommandTitle(message.input.command) : "Bash")
    }
    if (message.toolKind === "web_search") {
      return message.input.query || "Web Search"
    }
    if (message.toolKind === "read_file") {
      return `Read ${stripWorkspacePath(message.input.filePath, localPath)}`
    }
    if (message.toolKind === "write_file") {
      return `Write ${stripWorkspacePath(message.input.filePath, localPath)}`
    }
    if (message.toolKind === "edit_file") {
      return `Edit ${stripWorkspacePath(message.input.filePath, localPath)}`
    }
    if (message.toolKind === "delete_file") {
      return `Delete ${stripWorkspacePath(message.input.filePath, localPath)}`
    }
    if (message.toolKind === "mcp_generic") {
      return `${toTitleCase(message.input.tool)} from ${toTitleCase(message.input.server)}`
    }
    if (message.toolKind === "subagent_task") {
      return message.input.subagentType || message.toolName
    }
    if (message.toolKind === "workflow") {
      return message.input.name ?? "Workflow"
    }
    return message.toolName
  }, [message.input, message.toolKind, message.toolName, localPath])

  const isAgent = useMemo(() => message.toolKind === "subagent_task", [message.toolKind])
  const description = useMemo(() => {
    if (message.toolKind === "skill") {
      return message.input.skill
    }
  }, [message.input, message.toolKind])

  const isBashTool = message.toolKind === "bash"
  const isWriteTool = message.toolKind === "write_file"
  const isEditTool = message.toolKind === "edit_file"
  const isDeleteTool = message.toolKind === "delete_file"
  const isReadTool = message.toolKind === "read_file"

  const resultText = useMemo(() => {
    if (typeof message.result === "string") return message.result
    if (!message.result) return ""
    if (isRecord(message.result)) {
      const content = message.result.content
      if (typeof content === "string") return content
    }
    return JSON.stringify(message.result, null, 2)
  }, [message.result])

  const readImages = useMemo(() => {
    if (!isReadTool) {
      const empty: ReadImageBlock[] = []
      return empty
    }

    if (isRecord(message.result)) {
      const blocks = message.result.blocks
      if (Array.isArray(blocks)) {
        const hydratedBlocks = extractReadImageBlocks(blocks)
        if (hydratedBlocks.length > 0) {
          return hydratedBlocks
        }
      }
    }

    return extractReadImageBlocks(message.rawResult)
  }, [isReadTool, message.rawResult, message.result])

  const inputText = useMemo(() => {
    switch (message.toolKind) {
      case "bash":
        return message.input.command
      case "write_file":
      case "delete_file":
        return message.input.content
      default:
        return JSON.stringify(message.input, null, 2)
    }
  }, [message])

  let inputBlockLabel: ReactNode
  if (isBashTool) {
    inputBlockLabel = (
      <span className="flex items-center gap-2 w-full">
        <span>Command</span>
        {Boolean(message.input.timeoutMs) && (
          <span className="text-muted-foreground">timeout: {String(message.input.timeoutMs)}ms</span>
        )}
        {Boolean(message.input.runInBackground) && (
          <span className="text-muted-foreground">background</span>
        )}
      </span>
    )
  } else if (isWriteTool) {
    inputBlockLabel = "Contents"
  } else {
    inputBlockLabel = "Input"
  }

  let toolInputSection: ReactNode
  if (isEditTool) {
    toolInputSection = (
      <FileContentView
        content=""
        isDiff
        oldString={message.input.oldString}
        newString={message.input.newString}
      />
    )
  } else if (isDeleteTool) {
    toolInputSection = <FileContentView content={message.input.content} />
  } else if (!isReadTool && !isWriteTool) {
    toolInputSection = (
      <MetaCodeBlock label={inputBlockLabel} copyText={inputText}>
        {inputText}
      </MetaCodeBlock>
    )
  } else {
    toolInputSection = null
  }

  let toolContent: ReactNode
  if (message.toolKind === "workflow" && !message.isError) {
    const hydratedResult: WorkflowToolResult | undefined = isRecord(message.result) && typeof message.result.text === "string"
      ? { taskId: typeof message.result.taskId === "string" ? message.result.taskId : undefined, text: message.result.text }
      : undefined
    const taskId = hydratedResult?.taskId
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
          {(() => {
            if (message.isError) {
              return <X className="size-4 text-destructive" />
            }
            if (isAgent) {
              return <UserRound className="size-4 text-muted-icon" />
            }
            if (message.toolKind === "workflow") {
              return <GitBranch className="size-4 text-muted-icon" />
            }
            return <LucideIconWrapper icon={getToolIcon(message.toolName)} className="size-4 text-muted-icon" />
          })()}
        </div>
        <MetaLabel className="text-left transition-opacity duration-200 truncate">
          <AnimatedShinyText
            animate={showLoadingState}
            shimmerWidth={Math.max(20, ((description || name)?.length ?? 33) * 3)}
          >
            {description || name}
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
              {toolInputSection}
              {hasResult && isReadTool && !message.isError && (
                readImages.length > 0 ? (
                  <div>
                    <span className="font-medium text-muted-foreground">Image</span>
                    <div className="mt-1">
                      <ReadResultImages images={readImages} />
                    </div>
                  </div>
                ) : (
                  <FileContentView
                    content={resultText}
                  />
                )
              )}
              {isWriteTool && !message.isError && (
                <FileContentView
                  content={message.input.content}
                />
              )}
              {hasResult && !isReadTool && !(isWriteTool && !message.isError) && !(isEditTool && !message.isError) && !(isDeleteTool && !message.isError) && (
                <MetaCodeBlock label={message.isError ? "Error" : "Result"} copyText={resultText}>
                  {resultText}
                </MetaCodeBlock>
              )}
            </div>
          </VerticalLineContainer>
        }
      >

        {toolContent}



      </ExpandableRow>
    </MetaRow>
  )
}
