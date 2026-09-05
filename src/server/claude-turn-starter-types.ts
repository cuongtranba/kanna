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

export interface StartClaudeTurnArgs {
  chatId: string
  projectId: string
  localPath: string
  additionalDirectories?: string[]
  stackProjects?: ResolvedStackBinding[]
  instructions?: Omit<KannaSystemPromptOptions, "stackProjects">
  model: string
  effort?: string
  planMode: boolean
  sessionToken: string | null
  forkSession: boolean
  onToolRequest: (request: HarnessToolRequest) => Promise<JsonValue>
  provider: AgentProvider
}

export interface StartTurnAppSettings {
  globalPromptAppend?: string
}

export interface StartTurnDeps {
  activeTurns: Map<string, ActiveTurn>
  startingTurns: Map<string, StartingTurn>
  claudeSessions: Map<string, ClaudeSessionState>
  drainingStreams: Map<string, { turn: HarnessTurn }>
  mentionedSubagentIdsByChat: Map<string, string[]>

  store: EventStore
  codexManager: CodexAppServerManager
  subagentOrchestrator: Pick<SubagentOrchestrator, "clearChatCancellation">

  clearDrainingStream: (chatId: string) => void
  emitStateChange: (chatId: string, options?: { immediate?: boolean }) => void
  resolveClaudeDriverPreference: () => ClaudeDriverPreference
  closeClaudeSession: (chatId: string, session: ClaudeSessionState) => void
  getSubagents: () => Subagent[]
  getAppSettingsSnapshot: () => StartTurnAppSettings
  listSkills: (chatId: string) => SkillRosterEntry[]
  generateTitleInBackground: (chatId: string, content: string, localPath: string, optimisticTitle: string) => Promise<void>
  pendingTools: PendingToolSlots
  startClaudeTurn: (args: StartClaudeTurnArgs) => Promise<HarnessTurn>
  findLastUserMessageId: (chatId: string) => string | null
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
  promptOverride?: string
  expandedCommand?: { name: string; kind: SlashCommandKind }
  onTurnRecorded?: () => Promise<void>
}

export interface StartTurnAfterTurnStartedCtx {
  args: StartTurnForChatArgs
  starting: StartingTurn
  chat: ChatRecord
  project: ProjectRecord
  loadExistingMessages: () => readonly TranscriptEntry[]
  shouldGenerateTitle: boolean
  optimisticTitle: string | null
  appendedUserMessageId: string | null
}
