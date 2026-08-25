// src/server/codex-session-types.ts
//
// The shape a codex rollout line becomes AFTER classification.
//
// Rollout JSONL is messy and version-skewed: two envelope shapes, ~20 payload
// types, snake_case throughout, and the same logical event often present in
// two places at once. `codex-rollout-line.ts` does that narrowing exactly once
// and hands the mapper this union, so the mapper contains no shape-sniffing.
//
// Two safety rules are encoded in the TYPES rather than left to the mapper's
// discipline, because both failed silently when they were conventions:
//
//  - `CodexCompactedRecord` carries NO `message` and NO `replacement_history`.
//    `replacement_history` is a full replay of the conversation so far; a
//    mapper that walks it duplicates the entire transcript, and every test
//    still passes. It is unreachable from this union by construction.
//  - `CodexReasoningRecord` carries NO `encrypted_content`, only the plain
//    `summary`. The encrypted blob is not ours to decode.

import type { ThreadTokenUsageUpdatedNotification } from "./codex-app-server-protocol"

/** The `payload.info` of an `event_msg/token_count` line. Can be null on the wire. */
export type CodexTokenInfo = ThreadTokenUsageUpdatedNotification["tokenUsage"]

export interface CodexSessionMeta {
  sessionId: string
  cwd: string
  cliVersion: string | null
  /**
   * Non-null on a subagent, agent, or forked rollout. v1 refuses to import
   * these — they duplicate their parent's content and have no parent linkage
   * in the UI. 99 of 534 rollouts on the reference machine are one of these.
   */
  parentThreadId: string | null
  forkedFromId: string | null
  agentPath: string | null
}

interface CodexRecordBase {
  /**
   * 0-based index of the PHYSICAL line this record came from, counting blank
   * and unparseable lines. Counting every line rather than every retained
   * record is what makes the index a pure function of byte position: widening
   * the classifier's retain table later cannot renumber anything already
   * imported.
   */
  lineIndex: number
  /** Epoch ms. Falls back to the session's first timestamp when the line has none. */
  timestamp: number
}

export interface CodexSessionMetaRecord extends CodexRecordBase {
  kind: "session_meta"
  meta: CodexSessionMeta
}

/** `turn_context` / `thread_settings_applied` — the only sources of the model name. */
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
  /** Empty in every record of the reference corpus (7455/7455). */
  summary: string[]
}

export interface CodexToolCallRecord extends CodexRecordBase {
  kind: "tool_call"
  callId: string
  /** `exec`, `apply_patch`, `exec_command`, `update_plan`, … */
  name: string
  /** Raw argument text — a JS snippet, a patch body, or a JSON string. */
  input: string
  /** Which rollout family it came from; decides how `input` is read. */
  family: "custom" | "function"
}

export interface CodexToolOutputRecord extends CodexRecordBase {
  kind: "tool_output"
  callId: string
  /** Flattened from the `string | Array<{type,text}>` the wire uses. */
  output: string
}

export interface CodexWebSearchRecord extends CodexRecordBase {
  kind: "web_search"
  query: string
}

export interface CodexTokenCountRecord extends CodexRecordBase {
  kind: "token_count"
  /** Null occurs on the wire; `normalizeCodexTokenUsage` would throw on it. */
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

/** Deliberately carries no payload — see the header note. */
export interface CodexCompactedRecord extends CodexRecordBase {
  kind: "compacted"
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
