import type { ThreadTokenUsageUpdatedNotification } from "./codex-app-server-protocol"

export type CodexTokenInfo = ThreadTokenUsageUpdatedNotification["tokenUsage"]

export interface CodexSessionMeta {
  sessionId: string
  cwd: string
  cliVersion: string | null
  parentThreadId: string | null
  forkedFromId: string | null
  agentPath: string | null
}

interface CodexRecordBase {
  lineIndex: number
  timestamp: number
}

export interface CodexSessionMetaRecord extends CodexRecordBase {
  kind: "session_meta"
  meta: CodexSessionMeta
}

export interface CodexModelHintRecord extends CodexRecordBase {
  kind: "model_hint"
  model: string | null
}

export interface CodexUserMessageRecord extends CodexRecordBase {
  kind: "user_message"
  text: string
}

export interface CodexAssistantMessageRecord extends CodexRecordBase {
  kind: "assistant_message"
  text: string
}

export interface CodexReasoningRecord extends CodexRecordBase {
  kind: "reasoning"
  summary: string[]
}

export interface CodexToolCallRecord extends CodexRecordBase {
  kind: "tool_call"
  callId: string
  name: string
  input: string
  family: "custom" | "function"
}

export interface CodexToolOutputRecord extends CodexRecordBase {
  kind: "tool_output"
  callId: string
  output: string
}

export interface CodexWebSearchRecord extends CodexRecordBase {
  kind: "web_search"
  query: string
}

export interface CodexTokenCountRecord extends CodexRecordBase {
  kind: "token_count"
  info: CodexTokenInfo | null
}

export interface CodexTurnCompleteRecord extends CodexRecordBase {
  kind: "turn_complete"
  lastAgentMessage: string
  durationMs: number
}

export interface CodexTurnAbortedRecord extends CodexRecordBase {
  kind: "turn_aborted"
  reason: string
  durationMs: number
}

export interface CodexCompactedRecord extends CodexRecordBase {
  kind: "compacted"
  summary: string | null
}

export type CodexRolloutRecord =
  | CodexSessionMetaRecord
  | CodexModelHintRecord
  | CodexUserMessageRecord
  | CodexAssistantMessageRecord
  | CodexReasoningRecord
  | CodexToolCallRecord
  | CodexToolOutputRecord
  | CodexWebSearchRecord
  | CodexTokenCountRecord
  | CodexTurnCompleteRecord
  | CodexTurnAbortedRecord
  | CodexCompactedRecord
