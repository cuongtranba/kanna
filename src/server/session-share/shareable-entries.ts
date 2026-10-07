import { isJsonObject, type JsonObject, type JsonValue } from "../../shared/json"
import { toolResultReadsSidecar } from "../../shared/tools"
import type { NormalizedToolCall } from "../../shared/tool-call-types"
import type { TranscriptEntry } from "../../shared/transcript-types"

const RENDERED_TOOL_RESULT_KEYS = ["tool_use_result", "toolUseResult"] as const

function parseDebugRaw(debugRaw: string): JsonValue {
  try {
    return JSON.parse(debugRaw)
  } catch {
    return null
  }
}

function renderedToolResultSidecar(debugRaw: string | undefined): string | undefined {
  if (!debugRaw) return undefined
  const parsed = parseDebugRaw(debugRaw)
  if (!isJsonObject(parsed)) return undefined
  const kept: JsonObject = Object.fromEntries(RENDERED_TOOL_RESULT_KEYS.flatMap((key) => {
    const value = parsed[key]
    return value === undefined ? [] : [[key, value]]
  }))
  return Object.keys(kept).length > 0 ? JSON.stringify(kept) : undefined
}

function shareableEntry(entry: TranscriptEntry, toolKinds: ReadonlyMap<string, NormalizedToolCall["toolKind"]>): TranscriptEntry | null {
  const base = { _id: entry._id, messageId: entry.messageId, createdAt: entry.createdAt }
  switch (entry.kind) {
    case "user_prompt":
      return {
        ...base,
        kind: "user_prompt",
        content: entry.content,
        steered: entry.steered,
        autoContinue: entry.autoContinue,
        expandedCommand: entry.expandedCommand,
      }
    case "assistant_text":
      return { ...base, kind: "assistant_text", text: entry.text }
    case "assistant_thinking":
      return { ...base, kind: "assistant_thinking", text: entry.text }
    case "tool_call":
      return { ...base, kind: "tool_call", tool: entry.tool }
    case "tool_result": {
      const toolKind = toolKinds.get(entry.toolId)
      return {
        ...base,
        kind: "tool_result",
        toolId: entry.toolId,
        content: entry.content,
        isError: entry.isError,
        debugRaw: toolKind && toolResultReadsSidecar(toolKind) ? renderedToolResultSidecar(entry.debugRaw) : undefined,
      }
    }
    case "result":
      return {
        ...base,
        kind: "result",
        subtype: entry.subtype,
        isError: entry.isError,
        durationMs: entry.durationMs,
        result: entry.result,
        codexErrorInfo: entry.codexErrorInfo,
      }
    case "api_error":
      return { ...base, kind: "api_error", status: entry.status, text: entry.text, apiErrorReason: entry.apiErrorReason }
    case "policy_refusal":
      return { ...base, kind: "policy_refusal", text: entry.text }
    case "compact_boundary":
      return { ...base, kind: "compact_boundary" }
    case "compact_summary":
      return { ...base, kind: "compact_summary", summary: entry.summary }
    case "context_cleared":
      return { ...base, kind: "context_cleared" }
    case "interrupted":
      return { ...base, kind: "interrupted" }
    default:
      return null
  }
}

export function shareableEntries(transcript: readonly TranscriptEntry[]): TranscriptEntry[] {
  const toolKinds = new Map(transcript.flatMap((entry) => (entry.kind === "tool_call" ? [[entry.tool.toolId, entry.tool.toolKind] as const] : [])))
  return transcript.flatMap((entry) => {
    if (entry.hidden) return []
    const shared = shareableEntry(entry, toolKinds)
    return shared ? [shared] : []
  })
}
