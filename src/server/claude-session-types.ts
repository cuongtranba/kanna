
import type { JsonArray, JsonObject } from "../shared/json"

export interface ClaudeSessionRecordBase {
  uuid?: string
  sessionId?: string
  timestamp?: string
  cwd?: string
}

export type ClaudeSessionUserBlock =
  | { type: "text"; text: string }
  | { type: "tool_result"; tool_use_id: string; content?: string | JsonObject | JsonArray; is_error?: boolean }
  | { type: "other" }

export type ClaudeSessionAssistantBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: JsonObject }
  | { type: "other" }

export interface ClaudeSessionUserRecord extends ClaudeSessionRecordBase {
  type: "user"
  content: string | ClaudeSessionUserBlock[]
  debugRaw?: string
}

export interface ClaudeSessionAssistantRecord extends ClaudeSessionRecordBase {
  type: "assistant"
  messageId?: string
  content: ClaudeSessionAssistantBlock[]
}

export interface ClaudeSessionSummaryRecord extends ClaudeSessionRecordBase {
  type: "summary"
  summary?: string
}

export interface ClaudeSessionCustomTitleRecord extends ClaudeSessionRecordBase {
  type: "custom-title"
  customTitle?: string
}

export interface ClaudeSessionOtherRecord extends ClaudeSessionRecordBase {
  type: "other"
}

export type ClaudeSessionRecord =
  | ClaudeSessionUserRecord
  | ClaudeSessionAssistantRecord
  | ClaudeSessionSummaryRecord
  | ClaudeSessionCustomTitleRecord
  | ClaudeSessionOtherRecord

export interface ParsedClaudeSession {
  sessionId: string
  filePath: string
  cwd: string
  firstTimestamp: number
  lastTimestamp: number
  records: ClaudeSessionRecord[]
  sourceHash: string
}
