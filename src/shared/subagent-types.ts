// Subagent domain types: definitions, runtime snapshots, loop progress.
// Extracted from types.ts to keep the barrel lean.
// All external consumers importing from "../shared/types" continue to work unchanged.

import type { AgentProvider } from "./core-types"
import type { ClaudeModelOptions, CodexModelOptions } from "./provider-model-types"
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
  modelOptions: ClaudeModelOptions | CodexModelOptions
  systemPrompt: string
  contextScope: SubagentContextScope
  triggerMode: SubagentTriggerMode
  workingDir?: string
  allowedPaths?: string[]
  // Per-subagent agentic-turn bound — the analog of Claude Code's agent
  // frontmatter `maxTurns`. Unset = unbounded (Claude Code's default).
  // Claude-SDK runs pass it natively to query() (graceful stop, output kept);
  // PTY/Codex runs get a host-side tool-call-count backstop (hard abort).
  maxTurns?: number
  createdAt: number
  updatedAt: number
}

export interface SubagentInput {
  name: string
  description?: string
  provider: AgentProvider
  model: string
  modelOptions: ClaudeModelOptions | CodexModelOptions
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
  modelOptions?: Partial<ClaudeModelOptions> | Partial<CodexModelOptions>
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

export interface ProviderUsage {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  costUsd?: number
}

export interface SubagentPendingTool {
  toolUseId: string
  toolKind: "ask_user_question" | "exit_plan_mode"
  input: Record<string, unknown>
  requestedAt: number
}

export interface SubagentRunSnapshot {
  runId: string
  chatId: string
  subagentId: string | null
  subagentName: string
  /**
   * Short human label for this run, derived from the first line of the spawn
   * prompt (e.g. "Migrate useKannaState.ts"). Null for runs started before this
   * field existed or by error paths that never carried a prompt. Drives the
   * Loop Progress panel rows so each round reads as the chunk it worked on
   * rather than an opaque run id.
   */
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
  /**
   * Every TranscriptEntry the subagent produced, in arrival order. Includes
   * tool_call, tool_result, system_init, account_info, result. assistant_text
   * entries also live here in addition to being concatenated into finalText
   * via subagent_message_delta — clients should prefer entries[] for rich
   * rendering, finalText only as a quick text-only summary.
   */
  entries: TranscriptEntry[]
  /**
   * Set while the subagent is awaiting a user response to an
   * interactive tool call (AskUserQuestion / ExitPlanMode). Null
   * otherwise. The orchestrator's wall-clock timeout is paused while
   * this is non-null.
   */
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
  /** The live auto-continue schedule id, so the panel's Resume action can accept it. */
  scheduleId: string
  /** epoch ms the usage limit resets (and the resume is/would be scheduled for) */
  resetAt: number
  tz: string
  /**
   * true  → an auto-continue is already scheduled to fire at `resetAt`
   *         (the loop resumes on its own).
   * false → the resume is only proposed and waits on the user
   *         (auto-resume setting off) — render a "Resume" action.
   */
  scheduled: boolean
}

export interface LoopProgressSnapshot {
  chatId: string
  /** Whether a loop is currently armed for this chat. */
  armed: boolean
  /** Latest first — most recent delegation at the top, mirroring PROGRESS.md. */
  rows: LoopRow[]
  /** Non-null while the loop is paused on a Claude usage limit. */
  rateLimit: LoopRateLimitInfo | null
}

// Type guards

export function isSubagentContextScope(value: string): value is SubagentContextScope {
  return value === "previous-assistant-reply" || value === "full-transcript"
}

export function isSubagentTriggerMode(value: string): value is SubagentTriggerMode {
  return value === "auto" || value === "manual"
}
