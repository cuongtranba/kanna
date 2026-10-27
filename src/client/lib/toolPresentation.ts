import {
  ArrowDownToLine,
  CheckLine,
  File,
  FilePen,
  FilePlusCorner,
  FileX,
  GitBranch,
  Image as ImageIcon,
  ListTodo,
  Map,
  MessageCircleQuestion,
  Pencil,
  Search,
  Sparkles,
  SquareX,
  Terminal,
  ToyBrick,
  UserRound,
  type LucideIcon,
} from "lucide-react"
import type { NormalizedToolCall } from "../../shared/types"
import { normalizeToolCall } from "../../shared/tools"
import { formatBashCommandTitle, toTitleCase, truncateEndEllipsis } from "./formatters"
import { stripWorkspacePath } from "./pathUtils"

type ToolKind = NormalizedToolCall["toolKind"]

type DistributivePick<T, K extends keyof T> = T extends T ? Pick<T, K> : never

type ToolLike = DistributivePick<NormalizedToolCall, "toolKind" | "toolName" | "input">

export interface ToolCategory {
  key: string
  singular: string
  plural: string
}

const OTHER_CATEGORY: ToolCategory = { key: "other", singular: "tool call", plural: "tool calls" }
const TASK_UPDATE_CATEGORY: ToolCategory = { key: "task", singular: "task update", plural: "task updates" }

const TOOL_CATEGORIES: Record<ToolKind, ToolCategory> = {
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
  task_create: TASK_UPDATE_CATEGORY,
  task_update: TASK_UPDATE_CATEGORY,
  task_get: TASK_UPDATE_CATEGORY,
  task_list: TASK_UPDATE_CATEGORY,
  ask_user_question: OTHER_CATEGORY,
  exit_plan_mode: OTHER_CATEGORY,
  mcp_generic: OTHER_CATEGORY,
  beacon: OTHER_CATEGORY,
  offer_download: OTHER_CATEGORY,
  preview_file: OTHER_CATEGORY,
  image_generation: OTHER_CATEGORY,
  image_view: OTHER_CATEGORY,
  workflow: OTHER_CATEGORY,
  unknown_tool: OTHER_CATEGORY,
}

export function toolCategory(toolKind: ToolKind): ToolCategory {
  return TOOL_CATEGORIES[toolKind]
}

export const DEFAULT_TOOL_ICON: LucideIcon = ToyBrick

const TOOL_ICONS: Record<ToolKind, LucideIcon> = {
  read_file: File,
  edit_file: FilePen,
  write_file: FilePlusCorner,
  delete_file: FileX,
  bash: Terminal,
  grep: Search,
  glob: Search,
  web_search: Search,
  subagent_task: UserRound,
  skill: Sparkles,
  todo_write: CheckLine,
  task_create: CheckLine,
  task_update: CheckLine,
  task_get: CheckLine,
  task_list: CheckLine,
  ask_user_question: MessageCircleQuestion,
  exit_plan_mode: Map,
  image_view: ImageIcon,
  workflow: GitBranch,
  mcp_generic: DEFAULT_TOOL_ICON,
  beacon: DEFAULT_TOOL_ICON,
  offer_download: DEFAULT_TOOL_ICON,
  preview_file: DEFAULT_TOOL_ICON,
  image_generation: DEFAULT_TOOL_ICON,
  unknown_tool: DEFAULT_TOOL_ICON,
}

const ICONS_FOR_UNNORMALIZED_TOOL_NAMES: Readonly<Record<string, LucideIcon>> = {
  Task: ListTodo,
  TaskOutput: ListTodo,
  Delete: FileX,
  NotebookEdit: Pencil,
  WebFetch: ArrowDownToLine,
  KillShell: SquareX,
  TaskStop: SquareX,
  EnterPlanMode: Map,
}

export function toolIcon(tool: DistributivePick<NormalizedToolCall, "toolKind" | "toolName">): LucideIcon {
  if (tool.toolKind === "unknown_tool") {
    return ICONS_FOR_UNNORMALIZED_TOOL_NAMES[tool.toolName] ?? DEFAULT_TOOL_ICON
  }
  return TOOL_ICONS[tool.toolKind]
}

export function toolIconByName(toolName: string): LucideIcon {
  return toolIcon(normalizeToolCall({ toolName, toolId: "", input: {} }))
}

export function toolTitle(tool: ToolLike, localPath: string | null | undefined): string {
  switch (tool.toolKind) {
    case "skill":
      return tool.input.skill
    case "glob":
      return `Search files ${tool.input.pattern === "**/*" ? "in all directories" : `matching ${tool.input.pattern}`}`
    case "grep":
      if (tool.input.outputMode === "count") return `Count \`${tool.input.pattern}\` occurrences`
      if (tool.input.outputMode === "content") return `Find \`${tool.input.pattern}\` in text`
      return `Find \`${tool.input.pattern}\` in files`
    case "bash":
      return tool.input.description || (tool.input.command ? formatBashCommandTitle(tool.input.command) : "Bash")
    case "web_search":
      return tool.input.query || "Web Search"
    case "read_file":
      return `Read ${stripWorkspacePath(tool.input.filePath, localPath)}`
    case "image_view":
      return `View ${stripWorkspacePath(tool.input.path, localPath) || tool.input.path}`
    case "write_file":
      return `Write ${stripWorkspacePath(tool.input.filePath, localPath)}`
    case "edit_file":
      return `Edit ${stripWorkspacePath(tool.input.filePath, localPath)}`
    case "delete_file":
      return `Delete ${stripWorkspacePath(tool.input.filePath, localPath)}`
    case "mcp_generic":
      return `${toTitleCase(tool.input.tool)} from ${toTitleCase(tool.input.server)}`
    case "beacon":
      return tool.input.beaconId ? `Beacon ${tool.input.beaconId}: ${tool.input.summary}` : tool.input.summary
    case "subagent_task":
      return tool.input.subagentType || tool.toolName
    case "workflow":
      return tool.input.name ?? "Workflow"
    case "ask_user_question":
    case "exit_plan_mode":
    case "todo_write":
    case "task_create":
    case "task_update":
    case "task_get":
    case "task_list":
    case "offer_download":
    case "preview_file":
    case "image_generation":
    case "unknown_tool":
      return tool.toolName
  }
}

const ACTIVITY_MAX_LEN = 40

function truncateActivity(text: string): string {
  return truncateEndEllipsis(text, ACTIVITY_MAX_LEN)
}

function pathActivity(verb: string, fallback: string, filePath: string, localPath: string): string {
  const relative = stripWorkspacePath(filePath, localPath)
  return relative ? `${verb} ${truncateActivity(relative)}` : fallback
}

export function toolActivity(tool: ToolLike, localPath: string): string {
  switch (tool.toolKind) {
    case "bash": {
      const title = tool.input.description
        || (tool.input.command ? formatBashCommandTitle(tool.input.command) : "")
      return title ? `$ ${truncateActivity(title)}` : "running bash..."
    }
    case "read_file":
      return pathActivity("reading", "reading file...", tool.input.filePath, localPath)
    case "write_file":
      return pathActivity("writing", "writing file...", tool.input.filePath, localPath)
    case "edit_file":
      return pathActivity("editing", "editing file...", tool.input.filePath, localPath)
    case "delete_file":
      return pathActivity("deleting", "deleting file...", tool.input.filePath, localPath)
    case "glob":
      return tool.input.pattern ? `globbing ${truncateActivity(tool.input.pattern)}` : "globbing..."
    case "grep":
      return tool.input.pattern ? `grepping ${truncateActivity(tool.input.pattern)}` : "grepping..."
    case "web_search":
      return tool.input.query ? `searching: ${truncateActivity(tool.input.query)}` : "searching web..."
    case "skill":
      return tool.input.skill ? `skill ${truncateActivity(tool.input.skill)}` : "running skill..."
    case "todo_write":
      return "updating todos..."
    case "task_create":
      return "creating task..."
    case "task_update":
      return "updating task..."
    case "task_get":
    case "task_list":
      return "reading tasks..."
    case "subagent_task":
      return tool.input.subagentType
        ? `delegating ${truncateActivity(tool.input.subagentType)}`
        : "delegating..."
    case "ask_user_question":
      return "asking..."
    case "exit_plan_mode":
      return "presenting plan..."
    case "offer_download":
      return "preparing download..."
    case "image_generation":
      return "generating image..."
    case "image_view":
      return "viewing image..."
    case "mcp_generic":
      return truncateActivity(`${tool.input.server}.${tool.input.tool}`)
    case "unknown_tool":
      return `running ${truncateActivity(tool.toolName)}`
    case "preview_file":
    case "beacon":
    case "workflow":
      return "running..."
  }
}
