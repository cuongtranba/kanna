import { useMemo } from "react"
import { ChevronRight } from "lucide-react"
import { ToolCallMessage } from "./ToolCallMessage"
import { MetaRow, MetaLabel } from "./shared"
import { AnimatedShinyText } from "../ui/animated-shiny-text"
import type { ProcessedToolCall } from "./types"
import type { HydratedTranscriptMessage } from "../../../shared/types"

interface ToolCategory {
  key: string
  singular: string
  plural: string
}

const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  read_file: { key: "read", singular: "read", plural: "reads" },
  edit_file: { key: "edit", singular: "edit", plural: "edits" },
  write_file: { key: "write", singular: "write", plural: "writes" },
  delete_file: { key: "delete", singular: "delete", plural: "deletes" },
  bash: { key: "bash", singular: "command", plural: "commands" },
  grep: { key: "grep", singular: "search", plural: "searches" },
  glob: { key: "glob", singular: "glob", plural: "globs" },
  subagent_task: { key: "task", singular: "agent", plural: "agents" },
  web_search: { key: "websearch", singular: "web search", plural: "web searches" },
  skill: { key: "skill", singular: "skill", plural: "skills" },
  todo_write: { key: "todo", singular: "todo update", plural: "todo updates" },
}

const OTHER_CATEGORY: ToolCategory = { key: "other", singular: "tool call", plural: "tool calls" }

function getToolCategory(toolKind: string): ToolCategory {
  return TOOL_CATEGORIES[toolKind] ?? OTHER_CATEGORY
}

function getToolGroupLabel(messages: HydratedTranscriptMessage[]): string {
  const counts = new Map<string, { category: ToolCategory; count: number }>()
  const order: string[] = []

  for (const msg of messages) {
    const toolKind = (msg as ProcessedToolCall).toolKind
    const category = getToolCategory(toolKind)

    const existing = counts.get(category.key)
    if (existing) {
      existing.count++
    } else {
      counts.set(category.key, { category, count: 1 })
      order.push(category.key)
    }
  }

  // Format as "N reads, M writes" in order of first appearance
  return order.map(key => {
    const { category, count } = counts.get(key)!
    return `${count} ${count === 1 ? category.singular : category.plural}`
  }).join(", ")
}

interface Props {
  messages: HydratedTranscriptMessage[]
  isLoading: boolean
  localPath?: string | null
  expanded: boolean
  onExpandedChange: (next: boolean) => void
  chatId?: string
}

export function CollapsedToolGroup({ messages, isLoading, localPath, expanded, onExpandedChange, chatId }: Props) {
  const label = useMemo(() => getToolGroupLabel(messages), [messages])

  // Check if any tool in the group is still in progress
  const anyInProgress = messages.some(msg => {
    const processed = msg as ProcessedToolCall
    return processed.result === undefined
  })

  const showLoadingState = anyInProgress && isLoading

  return (
    <MetaRow className="w-full">
      <div className="flex flex-col w-full">
        <button
          onClick={() => onExpandedChange(!expanded)}
          className={`group cursor-pointer grid grid-cols-[auto_1fr] items-center gap-1 text-sm ${!expanded && !showLoadingState ? "hover:opacity-60 transition-opacity" : ""}`}
        >
          <div className="grid grid-cols-[auto_1fr] items-center gap-1.5">
            <div className="w-5 h-5 relative flex items-center justify-center">
              <ChevronRight
                className={`h-4.5 w-4.5 text-muted-icon transition-all duration-200 ${expanded ? "rotate-90" : ""}`}
              />
            </div>
            <MetaLabel className="text-left">
              <AnimatedShinyText animate={showLoadingState}>{label}</AnimatedShinyText>
            </MetaLabel>
          </div>
        </button>
        {expanded && (
          <div className="my-4 flex flex-col gap-3">
            {messages.map(msg => (
              <ToolCallMessage
                key={msg.id}
                message={msg as ProcessedToolCall}
                isLoading={isLoading}
                localPath={localPath}
                chatId={chatId}
              />
            ))}
            {messages.length > 5 && (
              <button
                onClick={() => onExpandedChange(false)}
                className="cursor-pointer grid grid-cols-[auto_1fr] items-center gap-1 text-xs hover:opacity-80 transition-opacity"
              >
                <div className="grid grid-cols-[auto_1fr] items-center gap-1.5">
                  <div className="w-5 h-5 relative flex items-center justify-center">
                    <ChevronRight className="h-4.5 w-4.5 text-muted-icon -rotate-90" />
                  </div>
                  <MetaLabel className="text-left">Collapse</MetaLabel>
                </div>
              </button>
            )}
          </div>
        )}
      </div>
    </MetaRow>
  )
}
