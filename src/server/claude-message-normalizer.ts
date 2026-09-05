
import type { TranscriptEntry } from "../shared/types"
import { isRecord } from "../shared/errors"
import { toJsonArray, toJsonObject } from "./json-boundary"
import { isJsonObject, type JsonArray, type JsonObject, type JsonValue } from "../shared/json"
import { normalizeToolCall } from "../shared/tools"


function stringFromUnknown<T>(value: T): string {
  if (typeof value === "string") return value
  if (value === undefined || value === null) return ""
  try {
    return JSON.stringify(value, null, 2) ?? ""
  } catch {
    return String(value)
  }
}

function normalizeMcpServerEntry(s: JsonValue): { name: string; status: string } {
  if (typeof s === "string") return { name: s, status: "connected" }
  if (isJsonObject(s) && typeof s.name === "string") {
    return { name: s.name, status: typeof s.status === "string" ? s.status : "connected" }
  }
  return { name: String(s), status: "connected" }
}


export function timestamped<T extends Omit<TranscriptEntry, "_id" | "createdAt">>(
  entry: T,
  createdAt = Date.now()
) {
  return {
    _id: crypto.randomUUID(),
    createdAt,
    ...entry,
  }
}


export interface ClaudeRawUsage {
  input_tokens?: number
  inputTokens?: number
  cache_creation_input_tokens?: number
  cacheCreationInputTokens?: number
  cache_read_input_tokens?: number
  cacheReadInputTokens?: number
  output_tokens?: number
  outputTokens?: number
  reasoning_output_tokens?: number
  reasoningOutputTokens?: number
  tool_uses?: number
  toolUses?: number
  duration_ms?: number
  durationMs?: number
}

export interface ClaudeRawModelUsage {
  contextWindow?: number
  context_window?: number
}

interface ClaudeRawContentBlock {
  type?: string
  text?: string
  thinking?: string
  signature?: string
  name?: string
  id?: string
  input?: JsonValue
  tool_use_id?: string
  content?: object | string | null
  is_error?: boolean
}
interface ClaudeRawMessageBody {
  id?: string
  content?: ClaudeRawContentBlock[] | string
  role?: string
  model?: string
  stop_reason?: string | null
  usage?: ClaudeRawUsage
}
export interface ClaudeRawSdkMessage {
  type?: string
  subtype?: string
  uuid?: string
  model?: string
  tools?: string[]
  agents?: string[]
  slash_commands?: string[]
  mcp_servers?: JsonValue[]
  message?: ClaudeRawMessageBody
  isApiErrorMessage?: boolean
  apiErrorStatus?: number
  request_id?: string
  requestId?: string
  is_error?: boolean
  duration_ms?: number
  result?: string
  total_cost_usd?: number
  status?: string | null
  summary?: string
  skip_transcript?: boolean
  tasks?: { task_id?: string; task_type?: string; description?: string }[]
  durationMs?: number
  pendingWorkflowCount?: number
  usage?: ClaudeRawUsage
  modelUsage?: Record<string, ClaudeRawModelUsage>
  rate_limit_info?: Record<string, string | number | boolean | null>
  session_id?: string
  stop_reason?: string | null
  task_id?: string
  output_file?: string
  tool_use_id?: string
}


export function getClaudeAssistantMessageUsageId(message: ClaudeRawSdkMessage): string | null {
  if (typeof message?.message?.id === "string" && message.message.id) {
    return message.message.id
  }
  if (typeof message?.uuid === "string" && message.uuid) {
    return message.uuid
  }
  return null
}


const SYNTHETIC_NON_ERROR_PLACEHOLDERS: ReadonlySet<string> = new Set([
  "No response requested.",
  "No action needed.",
  "Nothing needed from you.",
])

const POLICY_REFUSAL_TEXT_MARKERS: readonly string[] = [
  "violate our Usage Policy",
  "unable to respond to this request",
]


export function normalizeToolContent<T>(c: T): string | JsonObject | JsonArray | null {
  if (c === null || c === undefined) return null
  if (typeof c === "string") return c
  if (Array.isArray(c)) return toJsonArray(c)
  if (isRecord(c)) return toJsonObject(c)
  return null
}

function isSdkToClaudeMessage(m: object): m is ClaudeRawSdkMessage {
  void m
  return true
}

export { isSdkToClaudeMessage }


export function normalizeClaudeStreamMessage(message: ClaudeRawSdkMessage): TranscriptEntry[] {
  const debugRaw = JSON.stringify(message)
  const messageId = typeof message.uuid === "string" ? message.uuid : undefined

  if (message.type === "system" && message.subtype === "init") {
    return [
      timestamped({
        kind: "system_init",
        messageId,
        provider: "claude",
        model: typeof message.model === "string" ? message.model : "unknown",
        tools: Array.isArray(message.tools) ? message.tools : [],
        agents: Array.isArray(message.agents) ? message.agents : [],
        slashCommands: Array.isArray(message.slash_commands)
          ? message.slash_commands.filter((entry: string) => !entry.startsWith("._"))
          : [],
        mcpServers: Array.isArray(message.mcp_servers)
          ? message.mcp_servers.map((s: JsonValue) => normalizeMcpServerEntry(s))
          : [],
        debugRaw,
      }),
    ]
  }

  if (message.type === "assistant" && Array.isArray(message.message?.content)) {
    const joinedText = message.message.content
      .filter((c): c is ClaudeRawContentBlock & { text: string } => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("")
    const isSyntheticModel = message.message?.model === "<synthetic>"
    const isBenignSyntheticPlaceholder = isSyntheticModel
      && SYNTHETIC_NON_ERROR_PLACEHOLDERS.has(joinedText.trim())
    if (
      message.isApiErrorMessage === true
      || (isSyntheticModel && !isBenignSyntheticPlaceholder)
    ) {
      const statusFromField = typeof message.apiErrorStatus === "number" ? message.apiErrorStatus : undefined
      const statusFromText = (() => {
        const match = /API Error:\s*(\d{3})/i.exec(joinedText)
        return match ? Number.parseInt(match[1], 10) : undefined
      })()
      let requestId: string | undefined
      if (typeof message.request_id === "string") {
        requestId = message.request_id
      } else if (typeof message.requestId === "string") {
        requestId = message.requestId
      } else {
        requestId = undefined
      }
      const isPolicyRefusal =
        message.message?.stop_reason === "refusal"
        || POLICY_REFUSAL_TEXT_MARKERS.some((marker) => joinedText.includes(marker))
      if (isPolicyRefusal) {
        return [timestamped({
          kind: "policy_refusal",
          messageId,
          text: joinedText,
          requestId,
          debugRaw,
        })]
      }
      return [timestamped({
        kind: "api_error",
        messageId,
        status: statusFromField ?? statusFromText ?? 0,
        text: joinedText,
        requestId,
        debugRaw,
      })]
    }
    if (isBenignSyntheticPlaceholder) {
      return []
    }
    const entries: TranscriptEntry[] = []
    for (const content of message.message.content) {
      if (content.type === "thinking" && typeof content.thinking === "string" && content.thinking.length > 0) {
        entries.push(timestamped({
          kind: "assistant_thinking",
          messageId,
          text: content.thinking,
          signature: typeof content.signature === "string" ? content.signature : undefined,
          debugRaw,
        }))
      }
      if (content.type === "text" && typeof content.text === "string") {
        entries.push(timestamped({
          kind: "assistant_text",
          messageId,
          text: content.text,
          debugRaw,
        }))
      }
      if (content.type === "tool_use" && typeof content.name === "string" && typeof content.id === "string") {
        entries.push(timestamped({
          kind: "tool_call",
          messageId,
          tool: normalizeToolCall({
            toolName: content.name,
            toolId: content.id,
            input: content.input !== undefined && isJsonObject(content.input) ? content.input : {},
          }),
          debugRaw,
        }))
      }
    }
    return entries
  }

  if (message.type === "user" && Array.isArray(message.message?.content)) {
    const entries: TranscriptEntry[] = []
    for (const content of message.message.content) {
      if (content.type === "tool_result" && typeof content.tool_use_id === "string") {
        entries.push(timestamped({
          kind: "tool_result",
          messageId,
          toolId: content.tool_use_id,
          content: normalizeToolContent(content.content),
          isError: Boolean(content.is_error),
          debugRaw,
        }))
      }
      if (message.message.role === "user" && typeof message.message.content === "string") {
        entries.push(timestamped({
          kind: "compact_summary",
          messageId,
          summary: message.message.content,
          debugRaw,
        }))
      }
    }
    return entries
  }

  if (message.type === "result") {
    if (message.subtype === "cancelled") {
      return [timestamped({ kind: "interrupted", messageId, debugRaw })]
    }
    return [
      timestamped({
        kind: "result",
        messageId,
        subtype: message.is_error ? "error" : "success",
        isError: Boolean(message.is_error),
        durationMs: typeof message.duration_ms === "number" ? message.duration_ms : 0,
        result: typeof message.result === "string" ? message.result : stringFromUnknown(message.result),
        costUsd: typeof message.total_cost_usd === "number" ? message.total_cost_usd : undefined,
        debugRaw,
      }),
    ]
  }

  if (message.type === "system" && message.subtype === "status" && typeof message.status === "string") {
    return [timestamped({ kind: "status", messageId, status: message.status, debugRaw })]
  }

  if (message.type === "system" && message.subtype === "task_notification") {
    const taskStatus = typeof message.status === "string" ? message.status : "completed"
    const summary = typeof message.summary === "string" && message.summary.length > 0
      ? message.summary
      : "(no summary)"
    const taskId = typeof message.task_id === "string" ? message.task_id : undefined
    return [timestamped({
      kind: "status",
      messageId,
      status: `Background task ${taskStatus}: ${summary}`,
      hidden: message.skip_transcript === true ? true : undefined,
      backgroundTaskId: taskId,
      debugRaw,
    })]
  }

  if (message.type === "system" && message.subtype === "background_tasks_changed") {
    const tasks = Array.isArray(message.tasks) ? message.tasks : []
    const ids: string[] = []
    const meta: { id: string; taskType: string | null; description: string | null }[] = []
    for (const task of tasks) {
      if (typeof task.task_id !== "string" || task.task_id.length === 0) continue
      if (task.task_type === "in_process_teammate") continue
      ids.push(task.task_id)
      meta.push({
        id: task.task_id,
        taskType: typeof task.task_type === "string" && task.task_type.length > 0 ? task.task_type : null,
        description: typeof task.description === "string" && task.description.length > 0 ? task.description : null,
      })
    }
    return [timestamped({
      kind: "status",
      messageId,
      status: `Background tasks: ${ids.length} running`,
      hidden: true,
      backgroundTaskIdsSnapshot: ids,
      backgroundTasksSnapshot: meta,
      debugRaw,
    })]
  }

  if (message.type === "system" && message.subtype === "turn_duration") {
    let durationMs: number
    if (typeof message.durationMs === "number") {
      durationMs = message.durationMs
    } else if (typeof message.duration_ms === "number") {
      durationMs = message.duration_ms
    } else {
      durationMs = 0
    }
    const pendingWorkflowCount = typeof message.pendingWorkflowCount === "number"
      ? message.pendingWorkflowCount
      : undefined
    return [
      timestamped({
        kind: "result",
        messageId,
        subtype: "success",
        isError: false,
        durationMs,
        result: "",
        costUsd: undefined,
        ...(pendingWorkflowCount !== undefined ? { pendingWorkflowCount } : {}),
        debugRaw,
      }),
    ]
  }

  if (message.type === "system" && message.subtype === "compact_boundary") {
    return [timestamped({ kind: "compact_boundary", messageId, debugRaw })]
  }

  if (message.type === "system" && message.subtype === "context_cleared") {
    return [timestamped({ kind: "context_cleared", messageId, debugRaw })]
  }

  if (
    message.type === "user" &&
    message.message?.role === "user" &&
    typeof message.message.content === "string" &&
    message.message.content.startsWith("This session is being continued")
  ) {
    return [timestamped({ kind: "compact_summary", messageId, summary: message.message.content, debugRaw })]
  }

  return []
}
