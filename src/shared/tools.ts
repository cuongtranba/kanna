import type {
  AskUserQuestionItem,
  AskUserQuestionAnswerMap,
  AskUserQuestionOption,
  AskUserQuestionToolResult,
  ExitPlanModeToolResult,
  HydratedToolCall,
  ImageGenerationToolResult,
  NormalizedToolCall,
  OfferDownloadToolResult,
  PreviewFileToolResult,
  ReadFileToolResult,
  TaskCreateToolResult,
  TaskListToolResult,
  TaskUpdateToolCall,
  TaskUpdateToolResult,
  TodoItem,
  WorkflowToolResult,
} from "./types"
import { isJsonObject, type JsonObject, type JsonValue } from "./json"
import { isTaskStatus } from "./tool-call-types"
import { beaconToolOp, summarizeBeaconCall } from "./beacon-tools"

export * from "./beacon-tools"

export const KANNA_MCP_SERVER_NAME = "kanna"

export function mcpToolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`
}

export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  const match = /^mcp__(.+?)__(.+)$/.exec(name)
  return match ? { server: match[1], tool: match[2] } : null
}

export function kannaToolName(tool: string): string {
  return mcpToolName(KANNA_MCP_SERVER_NAME, tool)
}

export const OFFER_DOWNLOAD_TOOL_NAME = kannaToolName("offer_download")
export const PREVIEW_FILE_TOOL_NAME = kannaToolName("preview_file")
export const EXPOSE_PORT_TOOL_NAME = kannaToolName("expose_port")
export const QUERY_TRACKING_FILE_TOOL_NAME = kannaToolName("query_tracking_file")
export const APPEND_TRACKING_ROW_TOOL_NAME = kannaToolName("append_tracking_row")
export const REPLACE_TRACKING_SECTION_TOOL_NAME = kannaToolName("replace_tracking_section")
export const TASK_CREATE_TOOL_NAME = kannaToolName("task_create")
export const TASK_UPDATE_TOOL_NAME = kannaToolName("task_update")
export const TASK_LIST_TOOL_NAME = kannaToolName("task_list")
export const TASK_GET_TOOL_NAME = kannaToolName("task_get")
export const TASK_NOTE_TOOL_NAME = kannaToolName("task_note")
export const TASK_CLAIM_TOOL_NAME = kannaToolName("task_claim")
export const TASK_SETTLE_TOOL_NAME = kannaToolName("task_settle")
export const TASK_INTEGRATE_TOOL_NAME = kannaToolName("task_integrate")
export const DELEGATE_SUBAGENT_TOOL_NAME = kannaToolName("delegate_subagent")
export const STOP_LOOP_TOOL_NAME = kannaToolName("stop_loop")
export const SETUP_LOOP_TOOL_NAME = kannaToolName("setup_loop")
export const ARM_CRON_TOOL_NAME = kannaToolName("arm_cron")
export const VALIDATE_CRON_TOOL_NAME = kannaToolName("validate_cron")
export const VALIDATE_MERMAID_TOOL_NAME = kannaToolName("validate_mermaid")
export const INBOX_REPORT_TOOL_NAME = kannaToolName("inbox_report")
export const VALIDATE_UI_TOOL_NAME = kannaToolName("validate_ui")
export const RUN_VERIFY_TOOL_NAME = kannaToolName("run_verify")
export const PLUGIN_LIST_TOOL_NAME = kannaToolName("plugin_list")
export const PLUGIN_VALIDATE_TOOL_NAME = kannaToolName("plugin_validate")
export const PLUGIN_LOGS_TOOL_NAME = kannaToolName("plugin_logs")
export const PLUGIN_SCAFFOLD_TOOL_NAME = kannaToolName("plugin_scaffold")
export const PLUGIN_INSTALL_TOOL_NAME = kannaToolName("plugin_install")
export const PLUGIN_RELOAD_TOOL_NAME = kannaToolName("plugin_reload")
export const ASK_USER_QUESTION_TOOL_NAME = kannaToolName("ask_user_question")
export const EXIT_PLAN_MODE_TOOL_NAME = kannaToolName("exit_plan_mode")
export const CLAUDE_ASK_USER_QUESTION_TOOL_NAME = "AskUserQuestion"
export const CLAUDE_EXIT_PLAN_MODE_TOOL_NAME = "ExitPlanMode"
export const CLAUDE_TODO_WRITE_TOOL_NAME = "TodoWrite"
export const CARD_MOVE_TOOL_NAME = kannaToolName("card_move")

function asRecord(value: JsonValue | undefined): JsonObject | null {
  return value !== undefined && isJsonObject(value) ? value : null
}

function isTaskUpdateStatus(value: JsonValue | undefined): value is TaskUpdateToolCall["input"]["status"] {
  return isTaskStatus(value) || value === "deleted"
}

function readTaskId(input: JsonObject): string {
  for (const key of ["taskId", "id", "task_id"]) {
    const value = input[key]
    if (typeof value === "string") return value
  }
  return ""
}

function parseWorkflowMeta(script: string): { name?: string; description?: string } {
  const name = script.match(/name\s*:\s*['"]([^'"]+)['"]/)?.[1]
  const description = script.match(/description\s*:\s*['"]([^'"]+)['"]/)?.[1]
  return { name, description }
}

type ToolKind = NormalizedToolCall["toolKind"]
type ToolInput<K extends ToolKind> = Extract<NormalizedToolCall, { toolKind: K }>["input"]

function stringInput(input: JsonObject, key: string): string {
  const value = input[key]
  return typeof value === "string" ? value : ""
}

function optionalStringInput(input: JsonObject, key: string): string | undefined {
  const value = input[key]
  return typeof value === "string" ? value : undefined
}

function parseAskUserQuestionOptions(value: JsonValue | undefined): AskUserQuestionOption[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((option) => {
    if (!isJsonObject(option) || typeof option.label !== "string") return []
    return [{ label: option.label, description: typeof option.description === "string" ? option.description : undefined }]
  })
}

function askUserQuestionText(q: JsonObject): string {
  if (typeof q.question === "string") return q.question
  return typeof q.text === "string" ? q.text : ""
}

function parseAskUserQuestions(input: JsonObject): AskUserQuestionItem[] {
  if (!Array.isArray(input.questions)) return []
  return input.questions.flatMap((q) => {
    if (!isJsonObject(q)) return []
    return [{
      id: typeof q.id === "string" ? q.id : undefined,
      question: askUserQuestionText(q),
      header: typeof q.header === "string" ? q.header : undefined,
      options: parseAskUserQuestionOptions(q.options),
      multiSelect: typeof q.multiSelect === "boolean" ? q.multiSelect : false,
    }]
  })
}

export function normalizeToolCall(args: {
  toolName: string
  toolId: string
  input: JsonObject
}): NormalizedToolCall {
  const { toolName, toolId, input } = args
  const call = <K extends ToolKind>(toolKind: K, callInput: ToolInput<K>) => ({
    kind: "tool" as const,
    toolKind,
    toolName,
    toolId,
    input: callInput,
    rawInput: input,
  })

  switch (toolName) {
    case CLAUDE_ASK_USER_QUESTION_TOOL_NAME:
    case ASK_USER_QUESTION_TOOL_NAME:
      return call("ask_user_question", { questions: parseAskUserQuestions(input) })
    case CLAUDE_EXIT_PLAN_MODE_TOOL_NAME:
    case EXIT_PLAN_MODE_TOOL_NAME:
      return call("exit_plan_mode", {
        plan: optionalStringInput(input, "plan"),
        summary: optionalStringInput(input, "summary"),
      })
    case CLAUDE_TODO_WRITE_TOOL_NAME:
      return call("todo_write", {
        todos: Array.isArray(input.todos)
          ? input.todos.filter(
              (t): t is TodoItem =>
                isJsonObject(t) &&
                typeof t.content === "string" &&
                typeof t.status === "string" &&
                typeof t.activeForm === "string",
            )
          : [],
      })
    case "TaskCreate":
      return call("task_create", {
        subject: stringInput(input, "subject"),
        description: stringInput(input, "description"),
        ...(typeof input.activeForm === "string" ? { activeForm: input.activeForm } : {}),
      })
    case "TaskUpdate":
      return call("task_update", {
        taskId: readTaskId(input),
        ...(typeof input.subject === "string" ? { subject: input.subject } : {}),
        ...(typeof input.activeForm === "string" ? { activeForm: input.activeForm } : {}),
        ...(isTaskUpdateStatus(input.status) ? { status: input.status } : {}),
      })
    case "TaskGet":
      return call("task_get", { taskId: readTaskId(input) })
    case "TaskList":
      return call("task_list", {})
    case "Skill":
      return call("skill", { skill: stringInput(input, "skill") })
    case "Glob":
      return call("glob", { pattern: stringInput(input, "pattern") })
    case "Grep":
      return call("grep", {
        pattern: stringInput(input, "pattern"),
        outputMode: optionalStringInput(input, "output_mode"),
      })
    case "Bash":
      return call("bash", {
        command: stringInput(input, "command"),
        description: optionalStringInput(input, "description"),
        timeoutMs: typeof input.timeout === "number" ? input.timeout : undefined,
        runInBackground: Boolean(input.run_in_background),
      })
    case "WebSearch":
      return call("web_search", { query: stringInput(input, "query") })
    case "Read":
      return call("read_file", { filePath: stringInput(input, "file_path") })
    case "Write":
      return call("write_file", {
        filePath: stringInput(input, "file_path"),
        content: stringInput(input, "content"),
      })
    case "Edit":
      return call("edit_file", {
        filePath: stringInput(input, "file_path"),
        oldString: stringInput(input, "old_string"),
        newString: stringInput(input, "new_string"),
      })
    case "Workflow": {
      const meta = parseWorkflowMeta(stringInput(input, "script"))
      return call("workflow", {
        name: meta.name,
        description: meta.description,
        scriptPath: optionalStringInput(input, "scriptPath"),
      })
    }
    case OFFER_DOWNLOAD_TOOL_NAME:
      return call("offer_download", {
        path: stringInput(input, "path"),
        label: optionalStringInput(input, "label"),
      })
    case PREVIEW_FILE_TOOL_NAME:
      return call("preview_file", {
        path: stringInput(input, "path"),
        label: optionalStringInput(input, "label"),
      })
  }

  const beaconOp = beaconToolOp(toolName)
  if (beaconOp !== null) {
    return call("beacon", {
      op: beaconOp,
      beaconId: stringInput(input, "beaconId"),
      summary: summarizeBeaconCall(beaconOp, input),
    })
  }

  const mcpTool = parseMcpToolName(toolName)
  if (mcpTool) {
    return call("mcp_generic", { server: mcpTool.server, tool: mcpTool.tool, payload: input })
  }

  if (typeof input.subagent_type === "string") {
    return call("subagent_task", { subagentType: input.subagent_type })
  }

  return call("unknown_tool", { payload: input })
}

function parseJsonValue(value: JsonValue): JsonValue {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

type ReadStructuredTextBlock = {
  type: "text"
  text: string
}

type ReadStructuredImageBlock = {
  type: "image"
  data: string
  mimeType?: string
}

function contentBlocks(value: JsonValue): readonly JsonValue[] | null {
  if (isJsonObject(value) && Array.isArray(value.content)) return value.content
  if (Array.isArray(value)) return value
  return null
}

function normalizeReadBlocks(value: JsonValue): Array<ReadStructuredTextBlock | ReadStructuredImageBlock> {
  const normalized: Array<ReadStructuredTextBlock | ReadStructuredImageBlock> = []

  for (const block of contentBlocks(value) ?? []) {
    if (!block || typeof block !== "object" || !("type" in block)) {
      continue
    }

    if (block.type === "text" && "text" in block && typeof block.text === "string") {
      normalized.push({ type: "text", text: block.text })
      continue
    }

    if (block.type === "image") {
      if ("data" in block && typeof block.data === "string") {
        normalized.push({
          type: "image",
          data: block.data,
          mimeType: "mimeType" in block && typeof block.mimeType === "string" ? block.mimeType : undefined,
        })
        continue
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
        normalized.push({
          type: "image",
          data: block.source.data,
          mimeType: "media_type" in block.source && typeof block.source.media_type === "string" ? block.source.media_type : undefined,
        })
      }
    }
  }

  return normalized
}

function extractMcpTextContent(value: JsonValue): string | null {
  const blocks = contentBlocks(value)
  if (!blocks) return null

  const parts: string[] = []
  for (const block of blocks) {
    if (block && typeof block === "object" && "type" in block && block.type === "text" && "text" in block && typeof block.text === "string") {
      parts.push(block.text)
    }
  }
  return parts.length > 0 ? parts.join("") : null
}

function unwrapMcpPayload(parsed: JsonValue): JsonObject | null {
  const innerText = extractMcpTextContent(parsed)
  return asRecord(innerText !== null ? parseJsonValue(innerText) : parsed)
}

function stringOfRecord(record: JsonObject | null, key: string): string {
  const value = record?.[key]
  return typeof value === "string" ? value : ""
}

function fileResultFields(record: JsonObject | null) {
  const fileName = stringOfRecord(record, "fileName")
  const displayName = record?.displayName
  return {
    contentUrl: stringOfRecord(record, "contentUrl"),
    relativePath: stringOfRecord(record, "relativePath"),
    fileName,
    displayName: typeof displayName === "string" ? displayName : fileName,
    size: typeof record?.size === "number" ? record.size : 0,
  }
}

export const STRUCTURED_RESULT_TOOL_KINDS: ReadonlySet<NormalizedToolCall["toolKind"]> = new Set<NormalizedToolCall["toolKind"]>([
  "ask_user_question",
  "exit_plan_mode",
  "task_create",
  "task_update",
  "task_list",
])

export function toolResultReadsSidecar(toolKind: NormalizedToolCall["toolKind"]): boolean {
  return STRUCTURED_RESULT_TOOL_KINDS.has(toolKind) || toolKind === "subagent_task"
}

export function hydrateToolResult(tool: NormalizedToolCall, raw: JsonValue): HydratedToolCall["result"] {
  const parsed = parseJsonValue(raw)

  switch (tool.toolKind) {
    case "ask_user_question": {
      const record = unwrapMcpPayload(parsed)
      const answers = asRecord(record?.answers) ?? (record ? record : {})
      const answersMap: AskUserQuestionAnswerMap = {}
      for (const [key, value] of Object.entries(answers)) {
        if (Array.isArray(value)) {
          answersMap[key] = value.map((entry) => String(entry))
        } else if (isJsonObject(value) && Array.isArray(value.answers)) {
          answersMap[key] = value.answers.map((entry) => String(entry))
        } else if (value == null || value === "") {
          answersMap[key] = []
        } else {
          answersMap[key] = [String(value)]
        }
      }
      return {
        answers: answersMap,
        ...(record?.discarded === true ? { discarded: true } : {}),
      } satisfies AskUserQuestionToolResult
    }
    case "exit_plan_mode": {
      const record = unwrapMcpPayload(parsed)
      return {
        confirmed: typeof record?.confirmed === "boolean" ? record.confirmed : undefined,
        clearContext: typeof record?.clearContext === "boolean" ? record.clearContext : undefined,
        message: typeof record?.message === "string" ? record.message : undefined,
        ...(record?.discarded === true ? { discarded: true } : {}),
      } satisfies ExitPlanModeToolResult
    }
    case "task_create": {
      const task = asRecord(asRecord(parsed)?.task)
      return {
        task: {
          id: typeof task?.id === "string" ? task.id : "",
          subject: typeof task?.subject === "string" ? task.subject : "",
        },
      } satisfies TaskCreateToolResult
    }
    case "task_update": {
      const record = asRecord(parsed)
      return {
        success: record?.success !== false,
        taskId: typeof record?.taskId === "string" ? record.taskId : "",
      } satisfies TaskUpdateToolResult
    }
    case "task_list": {
      const rawTasks = asRecord(parsed)?.tasks
      return {
        tasks: Array.isArray(rawTasks)
          ? rawTasks.flatMap((entry) => {
              const task = asRecord(entry)
              if (!task || typeof task.id !== "string") return []
              return [{
                id: task.id,
                subject: typeof task.subject === "string" ? task.subject : "",
                status: isTaskStatus(task.status) ? task.status : "pending",
              }]
            })
          : [],
      } satisfies TaskListToolResult
    }
    case "offer_download": {
      const record = unwrapMcpPayload(parsed)
      return {
        ...fileResultFields(record),
        ...(typeof record?.mimeType === "string" ? { mimeType: record.mimeType } : {}),
      } satisfies OfferDownloadToolResult
    }
    case "preview_file": {
      const record = unwrapMcpPayload(parsed)
      return {
        ...fileResultFields(record),
        mimeType: typeof record?.mimeType === "string" ? record.mimeType : "application/octet-stream",
      } satisfies PreviewFileToolResult
    }
    case "image_generation": {
      const record = asRecord(parsed)
      return {
        contentUrl: stringOfRecord(record, "contentUrl"),
        relativePath: stringOfRecord(record, "relativePath"),
        fileName: stringOfRecord(record, "fileName"),
      } satisfies ImageGenerationToolResult
    }
    case "workflow": {
      const text = typeof raw === "string" ? raw : ""
      const taskId = text.match(/Task ID:\s*(\S+)/)?.[1]
      return {
        taskId,
        text,
      } satisfies WorkflowToolResult
    }
    case "read_file": {
      if (typeof parsed === "string") {
        return parsed
      }
      const blocks = normalizeReadBlocks(parsed)
      if (blocks.length > 0) {
        return {
          content: blocks
            .flatMap((block) => block.type === "text" ? [block.text] : [])
            .join(""),
          blocks,
        } satisfies ReadFileToolResult
      }

      const record = asRecord(parsed)
      return {
        content: typeof record?.content === "string" ? record.content : JSON.stringify(parsed, null, 2),
      } satisfies ReadFileToolResult
    }
    default:
      return parsed
  }
}
