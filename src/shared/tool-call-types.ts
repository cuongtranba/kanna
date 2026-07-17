/**
 * Tool call shapes (raw + hydrated) — extracted from shared/types.ts.
 * Completely self-contained: no imports from types.ts.
 * Imported via the re-export barrel in types.ts; all external consumers
 * continue to import from "../shared/types" unchanged.
 */

// ---------------------------------------------------------------------------
// AskUserQuestion / TodoWrite payload primitives
// ---------------------------------------------------------------------------

export interface AskUserQuestionOption {
  label: string
  description?: string
}

export interface AskUserQuestionItem {
  id?: string
  question: string
  header?: string
  options?: AskUserQuestionOption[]
  multiSelect?: boolean
}

export type AskUserQuestionAnswerMap = Record<string, string[]>

export interface TodoItem {
  content: string
  status: "pending" | "in_progress" | "completed"
  activeForm: string
}

// ---------------------------------------------------------------------------
// Raw tool call shapes
// ---------------------------------------------------------------------------

interface ToolCallBase<TKind extends string, TInput> {
  kind: "tool"
  toolKind: TKind
  toolName: string
  toolId: string
  input: TInput
  rawInput?: Record<string, unknown>
}

export interface AskUserQuestionToolCall
  extends ToolCallBase<"ask_user_question", { questions: AskUserQuestionItem[] }> { }

export interface ExitPlanModeToolCall
  extends ToolCallBase<"exit_plan_mode", { plan?: string; summary?: string }> { }

export interface TodoWriteToolCall
  extends ToolCallBase<"todo_write", { todos: TodoItem[] }> { }

export interface SkillToolCall
  extends ToolCallBase<"skill", { skill: string }> { }

export interface GlobToolCall
  extends ToolCallBase<"glob", { pattern: string }> { }

export interface GrepToolCall
  extends ToolCallBase<"grep", { pattern: string; outputMode?: string }> { }

export interface BashToolCall
  extends ToolCallBase<"bash", { command: string; description?: string; timeoutMs?: number; runInBackground?: boolean }> { }

export interface WebSearchToolCall
  extends ToolCallBase<"web_search", { query: string }> { }

export interface ReadFileToolCall
  extends ToolCallBase<"read_file", { filePath: string }> { }

export interface WriteFileToolCall
  extends ToolCallBase<"write_file", { filePath: string; content: string }> { }

export interface EditFileToolCall
  extends ToolCallBase<"edit_file", { filePath: string; oldString: string; newString: string }> { }

export interface DeleteFileToolCall
  extends ToolCallBase<"delete_file", { filePath: string; content: string }> { }

export interface SubagentTaskToolCall
  extends ToolCallBase<"subagent_task", { subagentType?: string }> { }

export interface McpGenericToolCall
  extends ToolCallBase<"mcp_generic", { server: string; tool: string; payload: Record<string, unknown> }> { }

export interface OfferDownloadToolCall
  extends ToolCallBase<"offer_download", { path: string; label?: string }> { }

export interface OfferDownloadToolResult {
  contentUrl: string
  relativePath: string
  fileName: string
  displayName: string
  size: number
  mimeType?: string
}

export interface PreviewFileToolCall
  extends ToolCallBase<"preview_file", { path: string; label?: string }> { }

export interface PreviewFileToolResult {
  contentUrl: string
  relativePath: string
  fileName: string
  displayName: string
  size: number
  mimeType: string
}

export type ImageGenerationStatus = "in_progress" | "completed" | "failed"

export interface ImageGenerationToolCall
  extends ToolCallBase<"image_generation", { revisedPrompt: string | null; status: ImageGenerationStatus }> { }

export interface ImageGenerationToolResult {
  contentUrl: string
  relativePath: string
  fileName: string
}

export interface UnknownToolCall
  extends ToolCallBase<"unknown_tool", { payload: Record<string, unknown> }> { }

export interface WorkflowToolCall
  extends ToolCallBase<"workflow", { name?: string; description?: string; scriptPath?: string }> { }

export type NormalizedToolCall =
  | AskUserQuestionToolCall
  | ExitPlanModeToolCall
  | TodoWriteToolCall
  | SkillToolCall
  | GlobToolCall
  | GrepToolCall
  | BashToolCall
  | WebSearchToolCall
  | ReadFileToolCall
  | WriteFileToolCall
  | EditFileToolCall
  | DeleteFileToolCall
  | SubagentTaskToolCall
  | McpGenericToolCall
  | OfferDownloadToolCall
  | PreviewFileToolCall
  | ImageGenerationToolCall
  | WorkflowToolCall
  | UnknownToolCall

// ---------------------------------------------------------------------------
// Hydrated tool call shapes
// ---------------------------------------------------------------------------

export interface HydratedToolCallBase<TKind extends string, TInput, TResult> {
  id: string
  messageId?: string
  hidden?: boolean
  kind: "tool"
  toolKind: TKind
  toolName: string
  toolId: string
  input: TInput
  result?: TResult
  rawResult?: string | Record<string, unknown> | readonly unknown[] | null
  isError?: boolean
  /**
   * Set when the underlying tool_result entry was persisted to disk
   * via the subagent payload cap. Mirrored from
   * ToolResultEntry.persisted during hydration.
   */
  persisted?: {
    filePath: string
    originalSize: number
    isJson: boolean
    truncated: true
  }
  timestamp: string
}

export interface AskUserQuestionToolResult {
  answers: AskUserQuestionAnswerMap
  discarded?: boolean
}

export interface ExitPlanModeToolResult {
  confirmed?: boolean
  clearContext?: boolean
  message?: string
  discarded?: boolean
}

export type HydratedAskUserQuestionToolCall =
  HydratedToolCallBase<"ask_user_question", AskUserQuestionToolCall["input"], AskUserQuestionToolResult>

export type HydratedExitPlanModeToolCall =
  HydratedToolCallBase<"exit_plan_mode", ExitPlanModeToolCall["input"], ExitPlanModeToolResult>

export type HydratedTodoWriteToolCall =
  HydratedToolCallBase<"todo_write", TodoWriteToolCall["input"], unknown>

export type HydratedSkillToolCall =
  HydratedToolCallBase<"skill", SkillToolCall["input"], unknown>

export type HydratedGlobToolCall =
  HydratedToolCallBase<"glob", GlobToolCall["input"], unknown>

export type HydratedGrepToolCall =
  HydratedToolCallBase<"grep", GrepToolCall["input"], unknown>

export type HydratedBashToolCall =
  HydratedToolCallBase<"bash", BashToolCall["input"], unknown>

export type HydratedWebSearchToolCall =
  HydratedToolCallBase<"web_search", WebSearchToolCall["input"], unknown>

export interface ReadFileTextBlock {
  type: "text"
  text: string
}

export interface ReadFileImageBlock {
  type: "image"
  data: string
  mimeType?: string
}

export interface ReadFileToolResult {
  content: string
  blocks?: Array<ReadFileTextBlock | ReadFileImageBlock>
}

export type HydratedReadFileToolCall =
  HydratedToolCallBase<"read_file", ReadFileToolCall["input"], ReadFileToolResult | string>

export type HydratedWriteFileToolCall =
  HydratedToolCallBase<"write_file", WriteFileToolCall["input"], unknown>

export type HydratedEditFileToolCall =
  HydratedToolCallBase<"edit_file", EditFileToolCall["input"], unknown>

export type HydratedDeleteFileToolCall =
  HydratedToolCallBase<"delete_file", DeleteFileToolCall["input"], unknown>

export interface SubagentToolStats {
  readCount?: number
  searchCount?: number
  bashCount?: number
  editFileCount?: number
  linesAdded?: number
  linesRemoved?: number
  otherToolCount?: number
}

// Parsed from the `Agent`/`Task` tool_result's top-level `toolUseResult`
// sidecar (camelCase, written by claude-code into the transcript JSONL and
// preserved on the tool_result entry's debugRaw). All fields optional — the
// SDK driver / older transcripts / in-flight calls may omit it entirely.
export interface SubagentTaskResult {
  agentId?: string
  agentType?: string
  status?: string
  totalTokens?: number
  totalDurationMs?: number
  totalToolUseCount?: number
  toolStats?: SubagentToolStats
  content?: string
}

export type HydratedSubagentTaskToolCall =
  HydratedToolCallBase<"subagent_task", SubagentTaskToolCall["input"], SubagentTaskResult>

export type HydratedMcpGenericToolCall =
  HydratedToolCallBase<"mcp_generic", McpGenericToolCall["input"], unknown>

export type HydratedOfferDownloadToolCall =
  HydratedToolCallBase<"offer_download", OfferDownloadToolCall["input"], OfferDownloadToolResult>

export type HydratedPreviewFileToolCall =
  HydratedToolCallBase<"preview_file", PreviewFileToolCall["input"], PreviewFileToolResult>

export type HydratedImageGenerationToolCall =
  HydratedToolCallBase<"image_generation", ImageGenerationToolCall["input"], ImageGenerationToolResult>

export interface WorkflowToolResult {
  taskId?: string
  text: string
}

export type HydratedWorkflowToolCall =
  HydratedToolCallBase<"workflow", WorkflowToolCall["input"], WorkflowToolResult>

export type HydratedUnknownToolCall =
  HydratedToolCallBase<"unknown_tool", UnknownToolCall["input"], unknown>

export type HydratedToolCall =
  | HydratedAskUserQuestionToolCall
  | HydratedExitPlanModeToolCall
  | HydratedTodoWriteToolCall
  | HydratedSkillToolCall
  | HydratedGlobToolCall
  | HydratedGrepToolCall
  | HydratedBashToolCall
  | HydratedWebSearchToolCall
  | HydratedReadFileToolCall
  | HydratedWriteFileToolCall
  | HydratedEditFileToolCall
  | HydratedDeleteFileToolCall
  | HydratedSubagentTaskToolCall
  | HydratedMcpGenericToolCall
  | HydratedOfferDownloadToolCall
  | HydratedPreviewFileToolCall
  | HydratedImageGenerationToolCall
  | HydratedWorkflowToolCall
  | HydratedUnknownToolCall
