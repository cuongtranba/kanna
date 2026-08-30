/**
 * Transcript entry shapes and the TranscriptEntry union — extracted from shared/types.ts.
 * Imported via the re-export barrel in types.ts; all external consumers
 * continue to import from "../shared/types" unchanged.
 *
 * import type = erased at compile time → no circular runtime dependency.
 */

import type { AgentProvider, ChatAttachment, ProviderUsage } from "./types"
import type { ToolRequestStatus, ToolRequestDecision } from "./permission-policy"
import type { NormalizedToolCall, HydratedToolCall } from "./tool-call-types"
import type { CodexErrorInfoTag } from "./codex-error-classification"
import type { CronMode, CronSkipReason } from "./cron/types"

// ---------------------------------------------------------------------------
// Shared info shapes (only referenced by transcript entries)
// ---------------------------------------------------------------------------

export interface McpServerInfo {
  name: string
  status: string
  error?: string
}

export interface AccountInfo {
  email?: string
  organization?: string
  subscriptionType?: string
  tokenSource?: string
  apiKeySource?: string
  oauthKeyMasked?: string
}

// ---------------------------------------------------------------------------
// Context window usage — only used by transcript entries
// ---------------------------------------------------------------------------

export interface ContextWindowUsageSnapshot {
  usedTokens: number
  totalProcessedTokens?: number
  maxTokens?: number
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  reasoningOutputTokens?: number
  lastUsedTokens?: number
  lastInputTokens?: number
  lastCachedInputTokens?: number
  lastOutputTokens?: number
  lastReasoningOutputTokens?: number
  toolUses?: number
  durationMs?: number
  /** USD cost for this turn. Provider-reported (Claude) or computed (others). */
  costUsd?: number
  compactsAutomatically: boolean
}

// ---------------------------------------------------------------------------
// Transcript entry base (private to this module)
// ---------------------------------------------------------------------------

interface TranscriptEntryBase {
  _id: string
  messageId?: string
  createdAt: number
  hidden?: boolean
  debugRaw?: string
}

// ---------------------------------------------------------------------------
// Transcript entry types
// ---------------------------------------------------------------------------

export interface ToolResultEntry extends TranscriptEntryBase {
  kind: "tool_result"
  toolId: string
  content: string | Record<string, unknown> | readonly unknown[] | null
  isError?: boolean
  /**
   * Set when the original content exceeded the subagent payload cap
   * (50 KB) and the full content was written to disk. `content` then
   * carries only a 2 KB preview wrapped in <persisted-output> tags.
   */
  persisted?: {
    filePath: string
    originalSize: number
    isJson: boolean
    truncated: true
  }
}

export interface UserPromptEntry extends TranscriptEntryBase {
  kind: "user_prompt"
  content: string
  attachments?: ChatAttachment[]
  steered?: boolean
  autoContinue?: { scheduleId: string }
  subagentMentions?: Array<{ subagentId: string; raw: string }>
  unknownSubagentMentions?: Array<{ name: string; raw: string }>
}

export interface SystemInitEntry extends TranscriptEntryBase {
  kind: "system_init"
  provider: AgentProvider
  model: string
  tools: string[]
  agents: string[]
  slashCommands: string[]
  mcpServers: McpServerInfo[]
}

export interface AccountInfoEntry extends TranscriptEntryBase {
  kind: "account_info"
  accountInfo: AccountInfo
}

export interface AssistantTextEntry extends TranscriptEntryBase {
  kind: "assistant_text"
  text: string
}

export interface AssistantThinkingEntry extends TranscriptEntryBase {
  kind: "assistant_thinking"
  text: string
  signature?: string
}

export interface ApiErrorEntry extends TranscriptEntryBase {
  kind: "api_error"
  status: number
  text: string
  requestId?: string
}

// A deliberate model refusal (Claude CLI returns stop_reason "refusal" /
// Usage-Policy block text) — distinct from a transport/overload api_error.
// Surfaced as its own kind so the UI can label it "Blocked — Usage Policy"
// instead of a generic red API-error card.
// See adr-20260607-surface-policy-refusal-entry.
export interface PolicyRefusalEntry extends TranscriptEntryBase {
  kind: "policy_refusal"
  text: string
  requestId?: string
}

export interface ToolCallEntry extends TranscriptEntryBase {
  kind: "tool_call"
  tool: NormalizedToolCall
}

export interface ResultEntry extends TranscriptEntryBase {
  kind: "result"
  subtype: "success" | "error" | "cancelled"
  isError: boolean
  durationMs: number
  result: string
  costUsd?: number
  usage?: ProviderUsage
  /**
   * Number of background Workflow tasks still running when this turn ended
   * (from claude-code's `turn_duration` frame). When > 0 the coordinator arms
   * a pending-workflow wake so the agent re-enters to harvest results instead
   * of going idle. Absent/0 on normal turns.
   * See adr-20260603-agent-self-scheduled-wake.
   */
  pendingWorkflowCount?: number
  /**
   * Codex's machine-readable reason for a failed turn, flattened to its variant
   * tag. Lets the UI say why the turn died and whether retrying can help,
   * instead of echoing the provider's raw sentence. Absent on success, on every
   * non-Codex provider, and whenever the tag is unrecognised.
   */
  codexErrorInfo?: CodexErrorInfoTag
}

export interface StatusEntry extends TranscriptEntryBase {
  kind: "status"
  status: string
  backgroundTaskId?: string
  /**
   * Level snapshot from `system/background_tasks_changed` — the full set of
   * live background task ids after a membership change. REPLACE semantics:
   * the session runner swaps its keep-alive guard set for this payload, so a
   * missed edge bookend can never wedge a stale running indicator.
   */
  backgroundTaskIdsSnapshot?: string[]
  /**
   * Per-task metadata riding the same `background_tasks_changed` snapshot
   * (same order/filter as `backgroundTaskIdsSnapshot`). Carries the SDK's
   * `task_type` + `description` so the UI can show WHICH tasks are running,
   * mirroring Claude Code's /tasks list.
   */
  backgroundTasksSnapshot?: { id: string; taskType: string | null; description: string | null }[]
}

export interface ContextWindowUpdatedEntry extends TranscriptEntryBase {
  kind: "context_window_updated"
  usage: ContextWindowUsageSnapshot
}

export interface CompactBoundaryEntry extends TranscriptEntryBase {
  kind: "compact_boundary"
}

export interface CompactSummaryEntry extends TranscriptEntryBase {
  kind: "compact_summary"
  summary: string
}

export interface ContextClearedEntry extends TranscriptEntryBase {
  kind: "context_cleared"
}

export interface InterruptedEntry extends TranscriptEntryBase {
  kind: "interrupted"
}

/**
 * An armed autonomous loop was disarmed. Rendered so a disarm is never silent:
 * a user message is a takeover and used to stop the loop with no trace at all,
 * which reads in the transcript as the loop simply going quiet.
 *
 * `resumable` reflects whether a `loop_armed` tombstone survived compaction, so
 * the card can offer `resume_loop` only when there is actually a spec to re-arm.
 */
export interface LoopDisarmedEntry extends TranscriptEntryBase {
  kind: "loop_disarmed"
  reason: LoopDisarmReason
  resumable: boolean
  trackingFileRel?: string
  workdirAbs?: string
}

/** Why an armed loop was disarmed. Mirrors the `loop_disarmed` event reason. */
export type LoopDisarmReason =
  | "goal_met"
  | "user_send"
  | "chat_deleted"
  | "repeated_failures"

/**
 * A Claude Code memory/rule file auto-loaded into context (CLAUDE.md, nested
 * CLAUDE.md, `.claude/rules/*.md`). PTY mode surfaces these from the
 * transcript's `type:"nested_memory"` lines. Path only — file content is
 * intentionally not carried (keeps the persisted/replayed event log light).
 */
export interface MemoryLoadedEntry extends TranscriptEntryBase {
  kind: "memory_loaded"
  path: string
}

export interface AutoContinuePromptEntry extends TranscriptEntryBase {
  kind: "auto_continue_prompt"
  scheduleId: string
}

export interface PendingToolRequestEntry extends TranscriptEntryBase {
  kind: "pending_tool_request"
  toolRequestId: string
  toolName: string
  arguments: Record<string, unknown>
}

export interface ToolRequestResolvedEntry extends TranscriptEntryBase {
  kind: "tool_request_resolved"
  toolRequestId: string
  status: ToolRequestStatus
  decision?: ToolRequestDecision
}

// ---------------------------------------------------------------------------
// Cron entries (`/cron` builtin — armed jobs, run cards, validation errors)
// ---------------------------------------------------------------------------

/** Static confirmation card appended when a job arms; the footer panel is the live surface. */
export interface CronArmedEntry extends TranscriptEntryBase {
  kind: "cron_armed"
  jobId: string
  instruction: string
  mode: CronMode
  scheduleText: string
  scheduleHuman: string
  nextFireAt: number | null
  model?: string
  upcomingFires?: readonly number[]
  cwd?: string
}

/** A `/cron` line that failed hard validation — precise error + optional ready-to-send fix. */
export interface CronCommandErrorEntry extends TranscriptEntryBase {
  kind: "cron_command_error"
  message: string
  /**
   * The line that failed. `/cron` starts no turn, so no `user_prompt` records
   * what the user typed — without this the card names a defect in a line the
   * reader cannot see. Absent only on entries with no single offending line.
   */
  input?: string
  suggestion?: string
}

/**
 * One spawn-mode fire: the run card in the arming (monitoring) chat. Live
 * status is joined client-side from `ChatSnapshot.cronJobs[].recentRuns` by
 * `runId` — the WorkflowMessage pattern.
 */
export interface CronRunEntry extends TranscriptEntryBase {
  kind: "cron_run"
  jobId: string
  runId: string
  instruction: string
  spawnedChatId?: string
  firedAt: number
}

export interface CronRunSkippedEntry extends TranscriptEntryBase {
  kind: "cron_run_skipped"
  jobId: string
  reason: CronSkipReason
  missedCount?: number
}

/** `/cron list` (and bare `/cron` help) — the component renders live jobs from the snapshot. */
export interface CronListEntry extends TranscriptEntryBase {
  kind: "cron_list"
  help?: boolean
}

export interface CronJobChangeEntry extends TranscriptEntryBase {
  kind: "cron_job_change"
  jobId: string
  change: "removed" | "paused" | "resumed" | "updated"
}

export type TranscriptEntry =
  | UserPromptEntry
  | SystemInitEntry
  | AccountInfoEntry
  | AssistantTextEntry
  | AssistantThinkingEntry
  | ApiErrorEntry
  | PolicyRefusalEntry
  | ToolCallEntry
  | ToolResultEntry
  | ResultEntry
  | StatusEntry
  | ContextWindowUpdatedEntry
  | CompactBoundaryEntry
  | CompactSummaryEntry
  | ContextClearedEntry
  | InterruptedEntry
  | LoopDisarmedEntry
  | MemoryLoadedEntry
  | AutoContinuePromptEntry
  | PendingToolRequestEntry
  | ToolRequestResolvedEntry
  | CronArmedEntry
  | CronCommandErrorEntry
  | CronRunEntry
  | CronRunSkippedEntry
  | CronListEntry
  | CronJobChangeEntry

// ---------------------------------------------------------------------------
// Hydrated transcript message (rich UI representation)
// ---------------------------------------------------------------------------

export type HydratedTranscriptMessage =
  | ({ kind: "user_prompt"; content: string; attachments?: ChatAttachment[]; steered?: boolean; autoContinue?: { scheduleId: string }; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "system_init"; model: string; tools: string[]; agents: string[]; slashCommands: string[]; mcpServers: McpServerInfo[]; provider: AgentProvider; id: string; messageId?: string; timestamp: string; hidden?: boolean; debugRaw?: string })
  | ({ kind: "account_info"; accountInfo: AccountInfo; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "assistant_text"; text: string; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "assistant_thinking"; text: string; signature?: string; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "api_error"; status: number; text: string; requestId?: string; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "policy_refusal"; text: string; requestId?: string; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "result"; success: boolean; cancelled?: boolean; result: string; durationMs: number; costUsd?: number; codexErrorInfo?: CodexErrorInfoTag; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "status"; status: string; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "context_window_updated"; usage: ContextWindowUsageSnapshot; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "compact_boundary"; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "compact_summary"; summary: string; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "context_cleared"; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "interrupted"; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "loop_disarmed"; reason: LoopDisarmReason; resumable: boolean; trackingFileRel?: string; workdirAbs?: string; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "memory_loaded"; path: string; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "unknown"; json: string; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "auto_continue_prompt"; scheduleId: string; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "pending_tool_request"; toolRequestId: string; toolName: string; arguments: Record<string, unknown>; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "cron_armed"; jobId: string; instruction: string; mode: CronMode; scheduleText: string; scheduleHuman: string; nextFireAt: number | null; model?: string; upcomingFires?: readonly number[]; cwd?: string; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "cron_command_error"; message: string; input?: string; suggestion?: string; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "cron_run"; jobId: string; runId: string; instruction: string; spawnedChatId?: string; firedAt: number; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "cron_run_skipped"; jobId: string; reason: CronSkipReason; missedCount?: number; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "cron_list"; help?: boolean; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "cron_job_change"; jobId: string; change: "removed" | "paused" | "resumed" | "updated"; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ id: string; messageId?: string; hidden?: boolean } & HydratedToolCall)
