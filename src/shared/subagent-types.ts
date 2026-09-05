import { type JsonObject } from "./json"

import type { AgentProvider } from "./core-types"
import type { ClaudeModelOptions, CodexModelOptions, OpenRouterModelOptions } from "./provider-model-types"
import type { TranscriptEntry } from "./transcript-types"

export type SubagentContextScope = "previous-assistant-reply" | "full-transcript"

export type SubagentTriggerMode = "auto" | "manual"

export interface SubagentRestriction {
  workingDir?: string
  allowedPaths?: string[]
}

export interface Subagent {
  id: string
  name: string
  description?: string
  provider: AgentProvider
  model: string
  modelOptions: ClaudeModelOptions | CodexModelOptions | OpenRouterModelOptions
  systemPrompt: string
  contextScope: SubagentContextScope
  triggerMode: SubagentTriggerMode
  workingDir?: string
  allowedPaths?: string[]
  maxTurns?: number
  createdAt: number
  updatedAt: number
}

export interface SubagentInput {
  name: string
  description?: string
  provider: AgentProvider
  model: string
  modelOptions: ClaudeModelOptions | CodexModelOptions | OpenRouterModelOptions
  systemPrompt: string
  contextScope: SubagentContextScope
  triggerMode?: SubagentTriggerMode
  workingDir?: string
  allowedPaths?: string[]
  maxTurns?: number
}

export interface SubagentPatch {
  name?: string
  description?: string | null
  provider?: AgentProvider
  model?: string
  modelOptions?: Partial<ClaudeModelOptions> | Partial<CodexModelOptions> | OpenRouterModelOptions
  systemPrompt?: string
  contextScope?: SubagentContextScope
  triggerMode?: SubagentTriggerMode
  workingDir?: string | null
  allowedPaths?: string[] | null
  maxTurns?: number | null
}

export type SubagentValidationErrorCode =
  | "EMPTY_NAME"
  | "INVALID_CHAR"
  | "RESERVED_NAME"
  | "DUPLICATE_NAME"
  | "TOO_LONG"
  | "NOT_FOUND"
  | "RESTRICTION_NOT_SUPPORTED"
  | "INVALID_PATH"
  | "PATH_ESCAPE"
  | "EMPTY_ALLOWED_PATHS"

export interface SubagentValidationError {
  code: SubagentValidationErrorCode
  message: string
}

export type SubagentErrorCode =
  | "AUTH_REQUIRED"
  | "UNKNOWN_SUBAGENT"
  | "MANUAL_ONLY"
  | "LOOP_DETECTED"
  | "DEPTH_EXCEEDED"
  | "TIMEOUT"
  | "MAX_TURNS"
  | "PROVIDER_ERROR"
  | "INTERRUPTED"
  | "USER_CANCELLED"
  | "CAP_EXCEEDED"
  | "NO_LIVE_SESSION"

export type SubagentRunStatus = "running" | "completed" | "failed" | "cancelled"

export const MAX_SUBAGENT_RUNS_PER_CHAT = 200
export const MAX_SUBAGENT_ENTRIES_PER_RUN = 2000

export interface ProviderUsage {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  costUsd?: number
}

export interface SubagentPendingTool {
  toolUseId: string
  toolKind: "ask_user_question" | "exit_plan_mode"
  input: JsonObject
  requestedAt: number
}

export interface SubagentRunSnapshot {
  runId: string
  chatId: string
  subagentId: string | null
  subagentName: string
  label: string | null
  provider: AgentProvider
  model: string
  status: SubagentRunStatus
  parentUserMessageId: string
  parentRunId: string | null
  depth: number
  startedAt: number
  finishedAt: number | null
  finalText: string | null
  error: { code: SubagentErrorCode; message: string } | null
  usage: ProviderUsage | null
  entries: TranscriptEntry[]
  pendingTool: SubagentPendingTool | null
}

export type LoopRowStatus = "pending" | "running" | "done" | "failed"

export interface LoopRow {
  runId: string
  label: string
  status: LoopRowStatus
  startedAt: number
  finishedAt: number | null
}

export interface LoopRateLimitInfo {
  scheduleId: string
  resetAt: number
  tz: string
  scheduled: boolean
}

export interface LoopProgressSnapshot {
  chatId: string
  armed: boolean
  rows: LoopRow[]
  rateLimit: LoopRateLimitInfo | null
}


export function isSubagentContextScope(value: string): value is SubagentContextScope {
  return value === "previous-assistant-reply" || value === "full-transcript"
}

export function isSubagentTriggerMode(value: string): value is SubagentTriggerMode {
  return value === "auto" || value === "manual"
}
