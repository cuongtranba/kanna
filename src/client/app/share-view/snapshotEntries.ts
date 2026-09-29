import { isJsonArray, isJsonObject, type JsonValue } from "../../../shared/json"
import type { ChatSnapshot, ChatSnapshotMessage, FrozenDataset } from "../../../shared/session-share/types"
import { normalizeToolCall } from "../../../shared/tools"
import type { ToolResultEntry, TranscriptEntry } from "../../../shared/transcript-types"

const NO_DATASETS: Readonly<Record<string, FrozenDataset>> = {}

function toolResultContent(output: JsonValue): ToolResultEntry["content"] {
  if (output === null || typeof output === "string" || isJsonObject(output) || isJsonArray(output)) return output
  return String(output)
}

function upgradeLegacyMessages(messages: readonly ChatSnapshotMessage[]): TranscriptEntry[] {
  const unansweredToolIds: string[] = []
  return messages.flatMap((message): TranscriptEntry[] => {
    const base = { _id: message.id, createdAt: message.createdAt }
    switch (message.kind) {
      case "user_prompt":
        return [{ ...base, kind: "user_prompt", content: message.text }]
      case "assistant_text":
        return [{ ...base, kind: "assistant_text", text: message.text }]
      case "assistant_thinking":
        return [{ ...base, kind: "assistant_thinking", text: message.text }]
      case "tool_call": {
        const toolId = `shared-tool:${message.id}`
        unansweredToolIds.push(toolId)
        const input = isJsonObject(message.input) ? message.input : {}
        return [{ ...base, kind: "tool_call", tool: normalizeToolCall({ toolName: message.name, toolId, input }) }]
      }
      case "tool_result": {
        const toolId = unansweredToolIds.shift()
        if (!toolId) return []
        return [{ ...base, kind: "tool_result", toolId, content: toolResultContent(message.output), isError: message.isError }]
      }
      case "diff":
      case "terminal_chunk":
      case "omitted":
        return []
    }
  })
}

export function snapshotTranscriptEntries(snapshot: ChatSnapshot): TranscriptEntry[] {
  return snapshot.version === 1 ? upgradeLegacyMessages(snapshot.messages) : snapshot.entries
}

export function snapshotDatasets(snapshot: ChatSnapshot): Readonly<Record<string, FrozenDataset>> {
  return snapshot.version === 1 ? NO_DATASETS : snapshot.datasets
}
