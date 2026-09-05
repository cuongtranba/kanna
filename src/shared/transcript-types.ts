import { type JsonObject, type JsonArray } from "./json"

import type { AgentProvider, ChatAttachment, ProviderUsage, SlashCommandKind } from "./types"
import type { ToolRequestStatus, ToolRequestDecision } from "./permission-policy"
import type { NormalizedToolCall, HydratedToolCall } from "./tool-call-types"
import type { CodexErrorInfoTag } from "./codex-error-classification"
import type { CronMode, CronSkipReason } from "./cron/types"


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
  costUsd?: number
  compactsAutomatically: boolean
}


interface TranscriptEntryBase {
  _id: string
  messageId?: string
  createdAt: number
  hidden?: boolean
  debugRaw?: string
}


export interface ToolResultEntry extends TranscriptEntryBase {
  kind: "tool_result"
  toolId: string
  content: string | JsonObject | JsonArray | null
  isError?: boolean
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
  expandedCommand?: { name: string; kind: SlashCommandKind }
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
  pendingWorkflowCount?: number
  codexErrorInfo?: CodexErrorInfoTag
}

export interface StatusEntry extends TranscriptEntryBase {
  kind: "status"
  status: string
  backgroundTaskId?: string
  backgroundTaskIdsSnapshot?: string[]
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

export interface LoopDisarmedEntry extends TranscriptEntryBase {
  kind: "loop_disarmed"
  reason: LoopDisarmReason
  resumable: boolean
  trackingFileRel?: string
  workdirAbs?: string
}

export type LoopDisarmReason =
  | "goal_met"
  | "user_send"
  | "chat_deleted"
  | "repeated_failures"

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
  arguments: JsonObject
}

export interface ToolRequestResolvedEntry extends TranscriptEntryBase {
  kind: "tool_request_resolved"
  toolRequestId: string
  status: ToolRequestStatus
  decision?: ToolRequestDecision
}


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

export interface CronCommandErrorEntry extends TranscriptEntryBase {
  kind: "cron_command_error"
  message: string
  input?: string
  suggestion?: string
}

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


export type HydratedTranscriptMessage =
  | ({ kind: "user_prompt"; content: string; attachments?: ChatAttachment[]; steered?: boolean; autoContinue?: { scheduleId: string }; expandedCommand?: { name: string; kind: SlashCommandKind }; id: string; messageId?: string; timestamp: string; hidden?: boolean })
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
  | ({ kind: "pending_tool_request"; toolRequestId: string; toolName: string; arguments: JsonObject; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "cron_armed"; jobId: string; instruction: string; mode: CronMode; scheduleText: string; scheduleHuman: string; nextFireAt: number | null; model?: string; upcomingFires?: readonly number[]; cwd?: string; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "cron_command_error"; message: string; input?: string; suggestion?: string; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "cron_run"; jobId: string; runId: string; instruction: string; spawnedChatId?: string; firedAt: number; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "cron_run_skipped"; jobId: string; reason: CronSkipReason; missedCount?: number; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "cron_list"; help?: boolean; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "cron_job_change"; jobId: string; change: "removed" | "paused" | "resumed" | "updated"; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ id: string; messageId?: string; hidden?: boolean } & HydratedToolCall)
