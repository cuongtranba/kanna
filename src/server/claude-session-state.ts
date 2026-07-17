/**
 * Core session and turn state types shared between AgentCoordinator (agent.ts)
 * and the extracted runClaudeSession event-loop (claude-session-runner.ts).
 *
 * Keeping these in a dedicated module avoids a circular import: agent.ts imports
 * values from claude-session-runner.ts, so claude-session-runner.ts must not
 * import values from agent.ts. Both sides import these type-only definitions
 * from this neutral file instead.
 */
import type { AgentProvider, KannaStatus, NormalizedToolCall, SlashCommand } from "../shared/types"
import type { AnyValue } from "../shared/errors"
import type { ClaudeSessionHandle, HarnessTurn } from "./harness-types"

export interface PendingToolRequest {
  toolUseId: string
  tool: NormalizedToolCall & { toolKind: "ask_user_question" | "exit_plan_mode" }
  resolve: (result: AnyValue) => void
}

export interface ActiveTurn {
  chatId: string
  provider: AgentProvider
  turn: HarnessTurn
  claudePromptSeq?: number
  model: string
  effort?: string
  serviceTier?: "fast"
  planMode: boolean
  status: KannaStatus
  pendingTool: PendingToolRequest | null
  postToolFollowUp: { content: string; planMode: boolean } | null
  hasFinalResult: boolean
  cancelRequested: boolean
  cancelRecorded: boolean
  clientTraceId?: string
  profilingStartedAt?: number
  waitStartedAt: number | null
  // True when this turn was synthesised by Kanna to inject `/compact` before
  // the user's real message. Used to update the per-chat compact circuit
  // breaker on completion (reset on success, increment on failure).
  proactiveCompactInjection?: boolean
  // _id of the user_prompt entry that triggered this turn (when appended on
  // this turn). Used to attribute main-Claude-initiated subagent runs to the
  // originating user message.
  userMessageId: string | null
}

export interface ClaudeSessionState {
  id: string
  chatId: string
  session: ClaudeSessionHandle
  localPath: string
  additionalDirectories: string[]
  model: string
  effort?: string
  planMode: boolean
  sessionToken: string | null
  accountInfoLoaded: boolean
  nextPromptSeq: number
  pendingPromptSeqs: number[]
  activeTokenId: string | null
  oauthKeyMasked: string | null
  oauthLabel: string | null
  // OpenRouter turns route through the SDK with ANTHROPIC_AUTH_TOKEN set to the
  // OpenRouter key, so the SDK self-reports a misleading Anthropic source. Hold
  // the OpenRouter identity here to surface it in the account_info entry.
  openrouterKeyMasked: string | null
  openrouterModel: string | null
  lastUsedAt: number
  // Claude-Code background Bash tasks (`Bash(run_in_background: true)`) run as
  // children of this PTY process and notify completion via a `<task-notification>`
  // transcript line that the continuous tail re-enters as a real turn — but ONLY
  // if the process is still alive. Track launched task ids + a keep-alive
  // deadline so the idle reaper / budget enforcer does not tear the process down
  // mid-flight. See adr-20260604-pty-background-task-keepalive.
  backgroundTaskIds: Set<string>
  backgroundTaskDeadlineAt: number
  // Armed-loop state captured at spawn. Both drivers bake the loop tool-block
  // into the spawn (PTY: --disallowedTools CLI args; SDK: options.disallowedTools
  // so the model never sees the blocked tools — Claude Code's filter-at-spawn
  // pattern). When the armed state changes (setup_loop arms / stop_loop or
  // user-send disarms) the session must be respawned at the next turn boundary
  // or the block goes stale.
  loopArmedAtSpawn: boolean
  /** SDK only: set once the workflows dir has been registered for this session. */
  workflowsDirRegistered?: boolean
  // Number of cancelled turns awaiting their interrupt-induced tail `result`.
  // The SDK's `interrupt()` resolves the query loop with a `result` whose
  // subtype is `error_during_execution` (NOT `cancelled`) and empty text, which
  // would otherwise render as "An unknown error occurred." after the
  // `interrupted` entry. Set on cancel, consumed (and the tail suppressed) when
  // that result arrives, reset on each new turn so a no-tail cancel can't leak
  // suppression onto a later real error.
  cancelledResultPending: number
  // Set by clearClaudeSessionContext (/clear machinery: setup_loop, background
  // delivery). Once the chat's context is declared cleared, any session_token
  // this in-flight session still emits belongs to the OLD conversation and
  // must never re-persist over the wipe. Fresh spawns start unsuppressed.
  suppressSessionTokenPersist: boolean
}

// Re-export SlashCommand as a convenience so importers of this module can get
// the type without adding a separate shared/types import.
export type { SlashCommand }
