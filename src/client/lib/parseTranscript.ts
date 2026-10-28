import { hydrateToolResult, STRUCTURED_RESULT_TOOL_KINDS } from "../../shared/tools"
import type { HydratedToolCall, HydratedToolCallBase, HydratedTranscriptMessage, NormalizedToolCall, SubagentTaskResult, SubagentToolStats, SystemInitEntry, ToolCallEntry, ToolRequestResolvedEntry, ToolResultEntry, ResultEntry, TranscriptEntry } from "../../shared/types"
import type { JsonArray, JsonObject, JsonValue } from "../../shared/json"
import { isJsonObject } from "../../shared/json"
import { asJsonValue } from "./asJsonValue"

type MutableToolCall = HydratedToolCallBase<string, NormalizedToolCall["input"], HydratedToolCall["result"]> & {
  isError?: boolean
  rawResult?: HydratedToolCall["rawResult"]
  persisted?: HydratedToolCall["persisted"]
}

function isMutableToolCallMsg(v: MutableToolCall): v is MutableToolCall & HydratedTranscriptMessage {
  return v.kind === "tool"
}

function createTimestamp(createdAt: number): string {
  return new Date(createdAt).toISOString()
}

type PassThroughEntry = Exclude<
  TranscriptEntry,
  ToolCallEntry | ToolResultEntry | ResultEntry | ToolRequestResolvedEntry | SystemInitEntry
>

function hydrateSystemInit(entry: SystemInitEntry) {
  const { _id, createdAt, ...fields } = entry
  return { ...fields, id: _id, timestamp: createTimestamp(createdAt) }
}

function hydratePassThrough(entry: PassThroughEntry) {
  const { _id, createdAt, debugRaw: _debugRaw, ...fields } = entry
  return { ...fields, id: _id, timestamp: createTimestamp(createdAt) }
}

function hydrateUnknownEntry(entry: never) {
  return {
    ...createBaseMessage(entry),
    kind: "unknown" as const,
    json: JSON.stringify(entry, null, 2),
  }
}

function createBaseMessage(entry: TranscriptEntry) {
  return {
    id: entry._id,
    messageId: entry.messageId,
    timestamp: createTimestamp(entry.createdAt),
    hidden: entry.hidden,
  }
}

const PLAN_FILE_DIRECTORY = "/.claude/plans/"

function isPlanFilePath(filePath: string): boolean {
  return filePath.includes(PLAN_FILE_DIRECTORY) && filePath.endsWith(".md")
}

function planWriteAfter(tool: NormalizedToolCall, planWrite: string | undefined): string | undefined {
  if (tool.toolKind === "exit_plan_mode") return undefined
  if (tool.toolKind === "write_file" && isPlanFilePath(tool.input.filePath)) return tool.input.content
  return planWrite
}

function hydrateToolInput(tool: NormalizedToolCall, planWrite: string | undefined): NormalizedToolCall["input"] {
  if (tool.toolKind === "exit_plan_mode" && !tool.input.plan && planWrite) {
    return { ...tool.input, plan: planWrite }
  }
  return tool.input
}

function hydrateToolCall(
  entry: Extract<TranscriptEntry, { kind: "tool_call" }>,
  planWrite: string | undefined,
): HydratedToolCallBase<string, NormalizedToolCall["input"], HydratedToolCall["result"]> {
  return {
    id: entry._id,
    messageId: entry.messageId,
    hidden: entry.hidden,
    kind: "tool",
    toolKind: entry.tool.toolKind,
    toolName: entry.tool.toolName,
    toolId: entry.tool.toolId,
    input: hydrateToolInput(entry.tool, planWrite),
    timestamp: createTimestamp(entry.createdAt),
  }
}

function getStructuredToolResultFromDebug(
  entry: Extract<TranscriptEntry, { kind: "tool_result" }>,
): string | JsonObject | JsonArray | undefined {
  if (!entry.debugRaw) return undefined

  let structured: JsonValue | undefined
  try {
    const parsed: { tool_use_result?: JsonValue } = JSON.parse(entry.debugRaw)
    structured = parsed.tool_use_result ?? undefined
  } catch {
    return undefined
  }
  if (structured === undefined || typeof structured === "number" || typeof structured === "boolean") {
    return undefined
  }
  return structured
}

function num(v: JsonValue | undefined): number | undefined { return typeof v === "number" ? v : undefined }
function str(v: JsonValue | undefined): string | undefined { return typeof v === "string" ? v : undefined }

function parseSubagentToolStats(v: JsonValue | undefined): SubagentToolStats | undefined {
  if (v === undefined || !isJsonObject(v)) return undefined
  const r = v
  const stats: SubagentToolStats = {
    readCount: num(r.readCount),
    searchCount: num(r.searchCount),
    bashCount: num(r.bashCount),
    editFileCount: num(r.editFileCount),
    linesAdded: num(r.linesAdded),
    linesRemoved: num(r.linesRemoved),
    otherToolCount: num(r.otherToolCount),
  }
  return Object.values(stats).some((n) => n !== undefined) ? stats : undefined
}

function getSubagentTaskResultFromDebug(
  entry: Extract<TranscriptEntry, { kind: "tool_result" }>,
): SubagentTaskResult | undefined {
  if (!entry.debugRaw) return undefined
  let sidecar: JsonValue | undefined
  try {
    const parsed: { toolUseResult?: JsonValue } = JSON.parse(entry.debugRaw)
    sidecar = parsed.toolUseResult
  } catch {
    return undefined
  }
  if (sidecar === undefined || !isJsonObject(sidecar)) return undefined
  const r = sidecar
  const result: SubagentTaskResult = {
    agentId: str(r.agentId),
    agentType: str(r.agentType),
    status: str(r.status),
    totalTokens: num(r.totalTokens),
    totalDurationMs: num(r.totalDurationMs),
    totalToolUseCount: num(r.totalToolUseCount),
    toolStats: parseSubagentToolStats(r.toolStats),
    content: str(r.content),
  }
  const hasSignal = result.agentId !== undefined || result.agentType !== undefined
    || result.totalTokens !== undefined || result.totalDurationMs !== undefined
    || result.status !== undefined
  return hasSignal ? result : undefined
}

export function processTranscriptMessages(entries: TranscriptEntry[]): HydratedTranscriptMessage[] {
  const pendingToolCalls = new Map<string, { hydrated: MutableToolCall; normalized: NormalizedToolCall }>()
  const messages: HydratedTranscriptMessage[] = []
  let planWrite: string | undefined

  for (const entry of entries) {
    switch (entry.kind) {
      case "user_prompt":
      case "account_info":
      case "assistant_text":
      case "assistant_thinking":
      case "api_error":
      case "policy_refusal":
      case "status":
      case "context_window_updated":
      case "compact_boundary":
      case "compact_summary":
      case "context_cleared":
      case "interrupted":
      case "memory_loaded":
      case "auto_continue_prompt":
      case "pending_tool_request":
      case "cron_armed":
      case "cron_command_error":
      case "cron_run":
      case "cron_run_skipped":
      case "cron_list":
      case "cron_job_change":
      case "webhook_delivery":
      case "inbound_delivery":
      case "loop_disarmed":
        messages.push(hydratePassThrough(entry))
        break
      case "system_init":
        messages.push(hydrateSystemInit(entry))
        break
      case "tool_call": {
        const toolCall = hydrateToolCall(entry, planWrite)
        planWrite = planWriteAfter(entry.tool, planWrite)
        pendingToolCalls.set(entry.tool.toolId, { hydrated: toolCall, normalized: entry.tool })
        if (isMutableToolCallMsg(toolCall)) messages.push(toolCall)
        break
      }
      case "tool_result": {
        const pendingCall = pendingToolCalls.get(entry.toolId)
        if (pendingCall) {
          const rawResult = STRUCTURED_RESULT_TOOL_KINDS.has(pendingCall.normalized.toolKind)
            ? getStructuredToolResultFromDebug(entry) ?? entry.content
            : entry.content

          if (pendingCall.normalized.toolKind === "subagent_task") {
            pendingCall.hydrated.result = getSubagentTaskResultFromDebug(entry)
          } else {
            pendingCall.hydrated.result = hydrateToolResult(pendingCall.normalized, asJsonValue(rawResult))
          }
          pendingCall.hydrated.rawResult = rawResult
          pendingCall.hydrated.isError = entry.isError
          if (entry.persisted) {
            pendingCall.hydrated.persisted = entry.persisted
          }
        }
        break
      }
      case "result":
        messages.push({
          ...createBaseMessage(entry),
          kind: "result",
          success: !entry.isError,
          cancelled: entry.subtype === "cancelled",
          result: entry.result,
          durationMs: entry.durationMs,
          costUsd: entry.costUsd,
          codexErrorInfo: entry.codexErrorInfo,
        })
        break
      case "tool_request_resolved":
        break
      default:
        messages.push(hydrateUnknownEntry(entry))
        break
    }
  }

  return messages
}
