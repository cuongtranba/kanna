/**
 * Argument and dependency shapes for the turn spawning pipeline
 * (`claude-turn-starter.ts`).
 *
 * Split out so the pipeline module stays under its architecture-budget ceiling
 * and so a caller that only needs the shape of a turn — `claude-send-command.ts`,
 * `claude-turn-runner.ts` — does not pull the whole spawn implementation in.
 * `claude-turn-starter.ts` re-exports every public name here, so importers are
 * free to keep taking them from there.
 */
import type {
  AgentProvider,
  ChatAttachment,
  ClaudeDriverPreference,
  ResolvedStackBinding,
  SlashCommandKind,
  Subagent,
  TranscriptEntry,
} from "../shared/types"
import type { CronRunTag } from "../shared/cron/types"
import type { JsonValue } from "../shared/json"
import type { KannaSystemPromptOptions, SkillRosterEntry } from "../shared/kanna-system-prompt"
import type { ChatRecord, ProjectRecord } from "./events"
import type { ActiveTurn, ClaudeSessionState, StartingTurn } from "./claude-session-state"
import type { PendingToolSlots } from "./pending-tool-slot"
import type { HarnessTurn, HarnessToolRequest } from "./harness-types"
import type { EventStore } from "./event-store"
import type { CodexAppServerManager } from "./codex-app-server"
import type { SubagentOrchestrator } from "./subagent-orchestrator"
import type { SendToStartingProfile } from "./claude-steer-log"

/** Args for the inner startClaudeTurn dep — mirrors the private method signature. */
export interface StartClaudeTurnArgs {
  chatId: string
  projectId: string
  localPath: string
  additionalDirectories?: string[]
  stackProjects?: ResolvedStackBinding[]
  /** Workspace / stack / per-project instruction blocks for this turn. */
  instructions?: Omit<KannaSystemPromptOptions, "stackProjects">
  model: string
  effort?: string
  planMode: boolean
  sessionToken: string | null
  forkSession: boolean
  onToolRequest: (request: HarnessToolRequest) => Promise<JsonValue>
  provider: AgentProvider
}

/** AppSettings snapshot fields consumed by the spawn pipeline. */
export interface StartTurnAppSettings {
  globalPromptAppend?: string
}

/**
 * All AgentCoordinator fields / methods accessed by the turn spawning pipeline.
 * Passed as a single deps argument to the two extracted functions.
 */
export interface StartTurnDeps {
  // Maps (mutable — methods read and write these)
  activeTurns: Map<string, ActiveTurn>
  /**
   * Turns whose provider session is still booting. Registered synchronously
   * here before the first `await` and removed in a `finally`, so cancel /
   * send-queueing / status derivation all see the chat as busy during the
   * spawn window.
   */
  startingTurns: Map<string, StartingTurn>
  claudeSessions: Map<string, ClaudeSessionState>
  drainingStreams: Map<string, { turn: HarnessTurn }>
  mentionedSubagentIdsByChat: Map<string, string[]>

  // Service objects
  store: EventStore
  codexManager: CodexAppServerManager
  subagentOrchestrator: Pick<SubagentOrchestrator, "clearChatCancellation">

  // Callbacks for private AgentCoordinator methods
  clearDrainingStream: (chatId: string) => void
  emitStateChange: (chatId: string, options?: { immediate?: boolean }) => void
  resolveClaudeDriverPreference: () => ClaudeDriverPreference
  /**
   * Tear down a Claude session. Only used when a cancel lands mid-boot under
   * the PTY driver, where interrupting the fresh turn kills the CLI and the
   * session in `claudeSessions` is left dead.
   */
  closeClaudeSession: (chatId: string, session: ClaudeSessionState) => void
  getSubagents: () => Subagent[]
  getAppSettingsSnapshot: () => StartTurnAppSettings
  /**
   * Local skills for this chat's cwd, named in Codex's `developerInstructions`.
   * Only the Codex branch reads it — the claude CLI discovers skills itself.
   */
  listSkills: (chatId: string) => SkillRosterEntry[]
  /** Fired in background (return value discarded). */
  generateTitleInBackground: (chatId: string, content: string, localPath: string, optimisticTitle: string) => Promise<void>
  pendingTools: PendingToolSlots
  startClaudeTurn: (args: StartClaudeTurnArgs) => Promise<HarnessTurn>
  findLastUserMessageId: (chatId: string) => string | null
  /** Fires the runTurn loop (return value discarded). */
  runTurn: (active: ActiveTurn) => void
}

export interface StartTurnForChatArgs {
  chatId: string
  provider: AgentProvider
  content: string
  attachments: ChatAttachment[]
  model: string
  effort?: string
  serviceTier?: "fast"
  planMode: boolean
  appendUserPrompt: boolean
  steered?: boolean
  autoContinue?: { scheduleId: string }
  cronRun?: CronRunTag
  userClearedContext?: boolean
  profile?: SendToStartingProfile | null
  /**
   * What the PROVIDER receives, when that differs from what the user typed.
   *
   * Set only when Kanna expanded a local slash command for a provider whose
   * harness cannot (`skill-invocation.ts`). `content` stays the typed line, so
   * the transcript bubble and the generated title read `/deploy staging` rather
   * than the skill's whole body.
   */
  promptOverride?: string
  /** Records on the `user_prompt` entry that Kanna expanded a slash command. */
  expandedCommand?: { name: string; kind: SlashCommandKind }
  /**
   * Invoked once `turn_started` is durably recorded — the point after which
   * this turn is replayable from the event log. Callers that hold the turn's
   * only durable trigger (a queued message) release it here, so a crash
   * before this point leaves the trigger intact instead of losing the turn.
   */
  onTurnRecorded?: () => Promise<void>
}

export interface StartTurnAfterTurnStartedCtx {
  args: StartTurnForChatArgs
  /** This boot's marker — checked once the provider session resolves. */
  starting: StartingTurn
  chat: ChatRecord
  project: ProjectRecord
  /** Lazy: reads recent tail entries for primer injection — avoids loading the full transcript. */
  loadExistingMessages: () => readonly TranscriptEntry[]
  shouldGenerateTitle: boolean
  optimisticTitle: string | null
  appendedUserMessageId: string | null
}
