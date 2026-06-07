import { hydrateToolResult } from "../../shared/tools"
import type { HydratedToolCall, HydratedTranscriptMessage, NormalizedToolCall, SubagentTaskResult, SubagentToolStats, TranscriptEntry } from "../../shared/types"

function createTimestamp(createdAt: number): string {
  return new Date(createdAt).toISOString()
}

function createBaseMessage(entry: TranscriptEntry) {
  return {
    id: entry._id,
    messageId: entry.messageId,
    timestamp: createTimestamp(entry.createdAt),
    hidden: entry.hidden,
  }
}

function hydrateToolCall(entry: Extract<TranscriptEntry, { kind: "tool_call" }>): HydratedToolCall {
  return {
    id: entry._id,
    messageId: entry.messageId,
    hidden: entry.hidden,
    kind: "tool",
    toolKind: entry.tool.toolKind,
    toolName: entry.tool.toolName,
    toolId: entry.tool.toolId,
    input: entry.tool.input as HydratedToolCall["input"],
    timestamp: createTimestamp(entry.createdAt),
  } as HydratedToolCall
}

function getStructuredToolResultFromDebug(entry: Extract<TranscriptEntry, { kind: "tool_result" }>): unknown {
  if (!entry.debugRaw) return undefined

  try {
    const parsed = JSON.parse(entry.debugRaw) as { tool_use_result?: unknown }
    return parsed.tool_use_result
  } catch {
    return undefined
  }
}

function num(v: unknown): number | undefined { return typeof v === "number" ? v : undefined }
function str(v: unknown): string | undefined { return typeof v === "string" ? v : undefined }

function parseSubagentToolStats(v: unknown): SubagentToolStats | undefined {
  if (!v || typeof v !== "object") return undefined
  const r = v as Record<string, unknown>
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

// The native `Agent`/`Task` tool_result carries a top-level `toolUseResult`
// (camelCase) sidecar with the subagent run stats. Kanna persists the whole
// message on the tool_result entry's debugRaw, so parse it back out defensively.
// Returns undefined when absent (SDK driver / older transcripts / in-flight),
// in which case the renderer falls back to the generic tool row.
function getSubagentTaskResultFromDebug(
  entry: Extract<TranscriptEntry, { kind: "tool_result" }>,
): SubagentTaskResult | undefined {
  if (!entry.debugRaw) return undefined
  let sidecar: unknown
  try {
    sidecar = (JSON.parse(entry.debugRaw) as { toolUseResult?: unknown }).toolUseResult
  } catch {
    return undefined
  }
  if (!sidecar || typeof sidecar !== "object") return undefined
  const r = sidecar as Record<string, unknown>
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
  // Require at least one identifying/stat field so a malformed `{}` sidecar
  // still falls back to the generic render.
  const hasSignal = result.agentId !== undefined || result.agentType !== undefined
    || result.totalTokens !== undefined || result.totalDurationMs !== undefined
    || result.status !== undefined
  return hasSignal ? result : undefined
}

export function processTranscriptMessages(entries: TranscriptEntry[]): HydratedTranscriptMessage[] {
  const pendingToolCalls = new Map<string, { hydrated: HydratedToolCall; normalized: NormalizedToolCall }>()
  const messages: HydratedTranscriptMessage[] = []

  for (const entry of entries) {
    switch (entry.kind) {
      case "user_prompt":
        messages.push({
          ...createBaseMessage(entry),
          kind: "user_prompt",
          content: entry.content,
          attachments: entry.attachments ?? [],
          steered: entry.steered,
          autoContinue: entry.autoContinue,
        })
        break
      case "system_init":
        messages.push({
          ...createBaseMessage(entry),
          kind: "system_init",
          provider: entry.provider,
          model: entry.model,
          tools: entry.tools,
          agents: entry.agents,
          slashCommands: entry.slashCommands,
          mcpServers: entry.mcpServers,
          debugRaw: entry.debugRaw,
        })
        break
      case "account_info":
        messages.push({
          ...createBaseMessage(entry),
          kind: "account_info",
          accountInfo: entry.accountInfo,
        })
        break
      case "assistant_text":
        messages.push({
          ...createBaseMessage(entry),
          kind: "assistant_text",
          text: entry.text,
        })
        break
      case "assistant_thinking":
        messages.push({
          ...createBaseMessage(entry),
          kind: "assistant_thinking",
          text: entry.text,
          signature: entry.signature,
        })
        break
      case "api_error":
        messages.push({
          ...createBaseMessage(entry),
          kind: "api_error",
          status: entry.status,
          text: entry.text,
          requestId: entry.requestId,
        })
        break
      case "policy_refusal":
        messages.push({
          ...createBaseMessage(entry),
          kind: "policy_refusal",
          text: entry.text,
          requestId: entry.requestId,
        })
        break
      case "tool_call": {
        const toolCall = hydrateToolCall(entry)
        pendingToolCalls.set(entry.tool.toolId, { hydrated: toolCall, normalized: entry.tool })
        messages.push(toolCall)
        break
      }
      case "tool_result": {
        const pendingCall = pendingToolCalls.get(entry.toolId)
        if (pendingCall) {
          const rawResult = (
            pendingCall.normalized.toolKind === "ask_user_question" ||
            pendingCall.normalized.toolKind === "exit_plan_mode"
          )
            ? getStructuredToolResultFromDebug(entry) ?? entry.content
            : entry.content

          if (pendingCall.normalized.toolKind === "subagent_task") {
            // Prefer the structured toolUseResult sidecar (tokens/duration/
            // stats); leave result undefined when absent so the renderer
            // falls back to the generic subagent row.
            pendingCall.hydrated.result = getSubagentTaskResultFromDebug(entry) as never
          } else {
            pendingCall.hydrated.result = hydrateToolResult(pendingCall.normalized, rawResult) as never
          }
          pendingCall.hydrated.rawResult = rawResult
          pendingCall.hydrated.isError = entry.isError
          // Phase 5: propagate persisted-on-disk metadata so renderers
          // can surface "View full output" affordance on the tool call.
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
        })
        break
      case "status":
        messages.push({
          ...createBaseMessage(entry),
          kind: "status",
          status: entry.status,
        })
        break
      case "context_window_updated":
        messages.push({
          ...createBaseMessage(entry),
          kind: "context_window_updated",
          usage: entry.usage,
        })
        break
      case "compact_boundary":
        messages.push({
          ...createBaseMessage(entry),
          kind: "compact_boundary",
        })
        break
      case "compact_summary":
        messages.push({
          ...createBaseMessage(entry),
          kind: "compact_summary",
          summary: entry.summary,
        })
        break
      case "context_cleared":
        messages.push({
          ...createBaseMessage(entry),
          kind: "context_cleared",
        })
        break
      case "interrupted":
        messages.push({
          ...createBaseMessage(entry),
          kind: "interrupted",
        })
        break
      case "memory_loaded":
        messages.push({
          ...createBaseMessage(entry),
          kind: "memory_loaded",
          path: entry.path,
        })
        break
      case "auto_continue_prompt":
        messages.push({
          ...createBaseMessage(entry),
          kind: "auto_continue_prompt",
          scheduleId: entry.scheduleId,
        })
        break
      case "pending_tool_request":
        messages.push({
          ...createBaseMessage(entry),
          kind: "pending_tool_request",
          toolRequestId: entry.toolRequestId,
          toolName: entry.toolName,
          arguments: entry.arguments,
        })
        break
      case "tool_request_resolved":
        // resolved entries are informational; drop them from the rendered transcript
        break
      default:
        messages.push({
          ...createBaseMessage(entry),
          kind: "unknown",
          json: JSON.stringify(entry, null, 2),
        })
        break
    }
  }

  return messages
}
