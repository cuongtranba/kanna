// src/server/claude-session-types.ts

import type { ParsedSession } from "./session-source"

export interface ClaudeSessionRecordBase {
  type: string
  uuid?: string
  parentUuid?: string | null
  sessionId?: string
  timestamp?: string
  cwd?: string
  version?: string
}

export interface ClaudeSessionUserRecord extends ClaudeSessionRecordBase {
  type: "user"
  message: {
    role: "user"
    content: string | Array<
      | { type: "text"; text: string }
      | { type: "tool_result"; tool_use_id: string; content?: string | Array<Record<string, unknown>>; is_error?: boolean }
    >
  }
  /**
   * Sidecar claude-code writes as a SIBLING of `message` (not nested inside
   * it) on the tool_result record for the native `Agent`/`Task` tool — carries
   * `agentId`/`agentType`/`status`/token+duration stats. Consumed via
   * ToolResultEntry.debugRaw by src/client/lib/parseTranscript.ts's
   * getSubagentTaskResultFromDebug, which powers subagent drill-in.
   */
  toolUseResult?: Record<string, unknown>
}

export interface ClaudeSessionAssistantRecord extends ClaudeSessionRecordBase {
  type: "assistant"
  message: {
    role: "assistant"
    id?: string
    content: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
    >
  }
}

export interface ClaudeSessionSummaryRecord extends ClaudeSessionRecordBase {
  type: "summary"
  summary?: string
}

export interface ClaudeSessionCustomTitleRecord extends ClaudeSessionRecordBase {
  type: "custom-title"
  customTitle?: string
}

export interface ClaudeSessionSystemRecord extends ClaudeSessionRecordBase {
  type: "system"
  content?: string
}

export type ClaudeSessionRecord =
  | ClaudeSessionUserRecord
  | ClaudeSessionAssistantRecord
  | ClaudeSessionSummaryRecord
  | ClaudeSessionCustomTitleRecord
  | ClaudeSessionSystemRecord
  | ClaudeSessionRecordBase

/**
 * Claude's shape of the provider-agnostic `ParsedSession`. Kept as a named
 * alias so the existing claude-side call sites (parser, scanner) read the same
 * as before while the importer speaks only the generic contract.
 */
export type ParsedClaudeSession = ParsedSession<ClaudeSessionRecord>
