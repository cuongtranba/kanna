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
  | MemoryLoadedEntry
  | AutoContinuePromptEntry
  | PendingToolRequestEntry
  | ToolRequestResolvedEntry

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
  | ({ kind: "result"; success: boolean; cancelled?: boolean; result: string; durationMs: number; costUsd?: number; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "status"; status: string; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "context_window_updated"; usage: ContextWindowUsageSnapshot; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "compact_boundary"; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "compact_summary"; summary: string; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "context_cleared"; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "interrupted"; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "memory_loaded"; path: string; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "unknown"; json: string; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "auto_continue_prompt"; scheduleId: string; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ kind: "pending_tool_request"; toolRequestId: string; toolName: string; arguments: Record<string, unknown>; id: string; messageId?: string; timestamp: string; hidden?: boolean })
  | ({ id: string; messageId?: string; hidden?: boolean } & HydratedToolCall)
