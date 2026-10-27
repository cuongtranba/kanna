import type { CommandOrigin } from "./command-origin"
import { type JsonObject, type JsonArray } from "./json"

import type { AgentProvider, ChatAttachment, ProviderUsage, SlashCommandKind } from "./types"
import type { ToolRequestStatus, ToolRequestDecision } from "./permission-policy"
import type { NormalizedToolCall, HydratedToolCall } from "./tool-call-types"
import type { CodexErrorInfoTag } from "./codex-error-classification"
import type { CronMode, CronSkipReason } from "./cron/types"
import type { InboundHandlerMode } from "./inbound/handler"
import type { WebhookMode } from "./webhooks/types"


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
  origin?: CommandOrigin
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
  apiErrorReason?: string
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
  cumulativeCostUsd?: number
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

export type CompactionTrigger = "auto" | "manual"

export interface CompactBoundaryMetadata {
  trigger?: CompactionTrigger
  preTokens?: number
  postTokens?: number
  durationMs?: number
}

export interface CompactBoundaryEntry extends TranscriptEntryBase {
  kind: "compact_boundary"
  compactMetadata?: CompactBoundaryMetadata
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

export interface WebhookDeliveryEntry extends TranscriptEntryBase {
  kind: "webhook_delivery"
  hookId: string
  hookName: string
  mode: WebhookMode
  deliveryId: string
  message?: string
}

export interface InboundDeliveryEntry extends TranscriptEntryBase {
  kind: "inbound_delivery"
  sourceKind: "mcp" | "webhook"
  sourceId: string
  sourceName: string
  mode: InboundHandlerMode
  deliveryId: string
  threadId: string
  message?: string
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
  | WebhookDeliveryEntry
  | InboundDeliveryEntry


type HydratedEntry<E extends TranscriptEntry> = E extends TranscriptEntry
  ? Omit<E, "_id" | "createdAt" | "debugRaw"> & { id: string; timestamp: string }
  : never

interface HydratedMessageBase {
  id: string
  messageId?: string
  timestamp: string
  hidden?: boolean
}

export type HydratedTranscriptMessage =
  | HydratedEntry<Exclude<TranscriptEntry, SystemInitEntry | ResultEntry | ToolCallEntry | ToolResultEntry | ToolRequestResolvedEntry>>
  | (HydratedEntry<SystemInitEntry> & { debugRaw?: string })
  | (HydratedMessageBase & {
    kind: "result"
    success: boolean
    cancelled?: boolean
    result: string
    durationMs: number
    costUsd?: number
    codexErrorInfo?: CodexErrorInfoTag
  })
  | (HydratedMessageBase & { kind: "unknown"; json: string })
  | ({ id: string; messageId?: string; hidden?: boolean } & HydratedToolCall)
