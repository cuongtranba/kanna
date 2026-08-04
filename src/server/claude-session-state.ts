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

/**
 * Metadata for one live Claude-Code background task on this session.
 * `taskType`/`description` come from the SDK `background_tasks_changed`
 * payload when available, else from the launching tool call (Bash command
 * description / Agent task description). `startedAt` is first-seen time.
 */
export interface SessionBackgroundTask {
  taskType: string | null
  description: string | null
  startedAt: number
}

/**
 * A turn that has been requested but whose provider session is still booting.
 *
 * `startTurnForChat` only registers an `ActiveTurn` AFTER `startClaudeTurn`
 * resolves — a full SDK/PTY session spawn on a cold chat, i.e. seconds. For
 * that whole window the chat had no server-side record at all, so `chat.cancel`
 * found nothing and returned silently (the user had to press Stop a second
 * time once the turn finally registered), a second `chat.send` started a
 * concurrent turn instead of queueing, and the snapshot reported `idle`.
 *
 * `ActiveTurn.turn` is a non-optional `HarnessTurn`, which does not exist yet
 * during the boot — hence this separate, deliberately minimal record. It is
 * registered synchronously before the first `await` and removed in a `finally`.
 */
export interface StartingTurn {
  chatId: string
  provider: AgentProvider
  startedAt: number
  /**
   * Set by `cancelChat` when Stop lands mid-boot. `startTurnForChat` reads it
   * once the provider session resolves and tears the fresh turn down instead
   * of registering it.
   */
  cancelRequested: boolean
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
  // if the process is still alive. Track launched task ids (keyed map, with the
  // task metadata surfaced to the UI) + a keep-alive deadline so the idle reaper
  // / budget enforcer does not tear the process down mid-flight.
  // See adr-20260604-pty-background-task-keepalive.
  backgroundTasks: Map<string, SessionBackgroundTask>
  backgroundTaskDeadlineAt: number
  // Number of watchdog wakes fired for the current watch epoch. The deadline
  // above is refreshed only on launch/settle/snapshot edges, so a quiet
  // long-running task (a 30+ min CI watch) expires it while perfectly healthy.
  // Instead of silently reaping, the sweep wakes the session (bounded by
  // backgroundTaskMaxWakes) so the agent re-checks and reports to the user.
  // Reset to 0 when the id set transitions empty→non-empty and on user send.
  // See adr-20260801-background-task-wake-escalation.
  backgroundTaskWakeCount: number
  // True while a task-notification self-wake turn is streaming entries on
  // this session WITHOUT a Kanna-driven turn (no ActiveTurn). Armed by the
  // runner on model-activity entries with no active turn, disarmed on the
  // turn's `result`/`interrupted` entry. Surfaced as KannaStatus "running"
  // by getActiveStatuses so the UI reflects the work (spinner + Stop) even
  // though no turn_started event exists.
  selfWakeActive: boolean
  // toolId → human description for recently streamed tool_call entries
  // (bounded FIFO). Lets the launch-regex fallback (tool_result "running in
  // background with ID: …") attach the launching call's description to the
  // background task when no background_tasks_changed snapshot arrives (PTY
  // driver; SDK version skew).
  recentToolDescriptions: Map<string, string>
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
