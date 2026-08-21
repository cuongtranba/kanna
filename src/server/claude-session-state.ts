/**
 * Core session and turn state types shared between AgentCoordinator (agent.ts)
 * and the extracted runClaudeSession event-loop (claude-session-runner.ts).
 *
 * Keeping these in a dedicated module avoids a circular import: agent.ts imports
 * values from claude-session-runner.ts, so claude-session-runner.ts must not
 * import values from agent.ts. Both sides import these type-only definitions
 * from this neutral file instead.
 */
import type { AgentProvider, KannaStatus, SlashCommand } from "../shared/types"
import type { ClaudeSessionHandle, HarnessTurn } from "./harness-types"

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
  outputPath: string | null
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

/**
 * Why a turn exists to compact, when it does.
 *
 * - `proactive` — Kanna injected `/compact` ahead of the user's real message.
 *   Only this kind is owned by the `compactFailureCount` circuit breaker and by
 *   the `message.dequeue` refusal: both exist to bound Kanna's OWN automatic
 *   injection, and a user who typed the command must not trip either.
 * - `user` — the user typed `/compact`. Reaches the claude CLI verbatim, so it
 *   emits a bare `compact_boundary` under PTY exactly as the proactive one does.
 * - `codex_summary` — Codex's app-server has no compaction request, so Kanna
 *   runs the summarization itself and reshapes the reply into `compact_summary`.
 */
export type CompactionTurnKind = "proactive" | "user" | "codex_summary"

/**
 * A compaction driven by the claude CLI, which under PTY writes only a
 * `compact_boundary` and never a `result` — so the boundary is the turn's
 * terminal signal. See adr-20260608-pty-compact-boundary-dequeue-finalize.
 */
export function isCliCompactTurn(turn: Pick<ActiveTurn, "compactionTurn"> | undefined): boolean {
  return turn?.compactionTurn === "proactive" || turn?.compactionTurn === "user"
}

/** A compaction the `compactFailureCount` circuit breaker owns. */
export function isProactiveCompactTurn(turn: Pick<ActiveTurn, "compactionTurn"> | undefined): boolean {
  return turn?.compactionTurn === "proactive"
}

export interface ActiveTurn {
  chatId: string
  provider: AgentProvider
  turn: HarnessTurn
  /**
   * When the user's send began, carried over from the `StartingTurn` this
   * replaced — so `kanna.turn.duration_ms` measures the latency a user
   * actually waits, spawn included, not just the streaming phase.
   */
  startedAt: number
  /**
   * `ClaudeSessionState.id` of the session this turn runs on, when it runs on
   * one (absent for providers with no Claude session, e.g. codex).
   *
   * This is what lets a dying session decide whether the chat's ActiveTurn is
   * ITS turn. The session map cannot answer that: a teardown initiated
   * anywhere but the runner (budget eviction, idle reap, `/clear`) deletes the
   * map entry first, so by the time the runner unwinds it no longer recognises
   * itself and used to skip the fail-close — leaving a turn that never ended.
   */
  sessionId?: string
  claudePromptSeq?: number
  model: string
  effort?: string
  serviceTier?: "fast"
  planMode: boolean
  status: KannaStatus
  postToolFollowUp: { content: string; planMode: boolean } | null
  hasFinalResult: boolean
  cancelRequested: boolean
  cancelRecorded: boolean
  clientTraceId?: string
  profilingStartedAt?: number
  waitStartedAt: number | null
  compactionTurn?: CompactionTurnKind
  /**
   * Set when this turn is a cron-fired run. The store's turn-terminal
   * observer reads it to append `cron_run_outcome` to the job's arming chat
   * — see cron/fire.ts.
   */
  cronRun?: import("../shared/cron/types").CronRunTag
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
  // True once this session has received at least one SDK
  // `background_tasks_changed` LEVEL snapshot. Per the SDK's own contract
  // (`sdk.d.ts` SDKBackgroundTasksChangedMessage) the level has REPLACE
  // semantics and is what a consumer needing "is background work running"
  // should hold, so from the first snapshot on SET MEMBERSHIP is the truth
  // and the deadline above is redundant: it fired 29.5 min after a healthy
  // `vite dev` server's last output byte and woke the user with a
  // <background-task-check> prompt. Sticky across an emptied set (it records
  // a driver capability, not a per-epoch fact) and dies with the session —
  // the SDK level is per-process, so a respawn MUST start false. Never true
  // on PTY: CLI >= 2.1.x writes no system rows to the transcript JSONL, so
  // that guard stays deadline-based.
  // See adr-20260808-background-task-level-signal-authoritative.
  backgroundTasksLevelSourced: boolean
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
  // Provenance gate for the regex-based background task launch detector:
  // toolIds whose tool_call was a known background-launching tool (Bash with
  // run_in_background, subagent_task, workflow). Only tool_results from ids in
  // this set are scanned for "Command running in background with ID: …" or
  // "Async agent launched successfully" — prevents a read of another chat's
  // transcript (whose content may echo those strings) from phantom-arming the
  // guard. Entries are removed once the corresponding tool_result is processed.
  backgroundLaunchToolIds: Set<string>
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
