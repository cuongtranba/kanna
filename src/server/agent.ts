import { type KannaMcpDelegationContext, type SetupLoopHandlerResult } from "./kanna-mcp"
import {
  findLastUserMessageId as findLastUserMessageIdFn,
  recreateActiveTurnFromSession as recreateActiveTurnFromSessionFn,
  type SessionRebuildDeps,
} from "./claude-session-rebuild"
import type { LoopSetupInput } from "./loop-template"
import { ensureTrackingFile } from "./loop-template-io.adapter"
import { homedir } from "node:os"
import type {
  AgentProvider,
  ChatAttachment,
  LlmProviderSnapshot,
  McpOAuthState,
  McpServerConfig,
  PendingToolSnapshot,
  QueuedChatMessage,
  SlashCommand,
  Subagent,
} from "../shared/types"
import type { ClientCommand } from "../shared/protocol"
import { EventStore } from "./event-store"
import type { AnalyticsReporter } from "./analytics"
import { NoopAnalyticsReporter } from "./analytics"
import { CodexAppServerManager } from "./codex-app-server"
import { realpathAdapter } from "./paths-fs.adapter"
import { type GenerateChatTitleResult, generateTitleForChatDetailed } from "./generate-title"
import type { ClaudeSessionHandle, HarnessToolRequest, HarnessTurn } from "./harness-types"
import { startClaudeSession } from "./claude-session-start"
import {
  isClaudeSdkProvider,
} from "./provider-catalog"
import { readLlmProviderSnapshot } from "./llm-provider"
import type { ModelPrice } from "../shared/token-pricing"
import { providerUsesSdkSession, type ClaudeDriverPreference, type CustomModelEntry } from "../shared/types"
import type { AutoContinueEvent } from "./auto-continue/events"
import { ClaudeLimitDetector, CodexLimitDetector, type LimitDetection, type LimitDetector } from "./auto-continue/limit-detector"
import { ClaudeAuthErrorDetector, type AuthErrorDetection } from "./auto-continue/auth-error-detector"
import type { ScheduleManager } from "./auto-continue/schedule-manager"
import type { LoopState } from "./auto-continue/read-model"
import type { TunnelGateway } from "./cloudflare-tunnel/gateway"
import { OAuthTokenPool } from "./oauth-pool/oauth-token-pool"
import { SubagentOrchestrator, type BackgroundRunOutcome, type ProviderRunStart } from "./subagent-orchestrator"
import {
  buildSubagentProviderRunForChat as buildSubagentProviderRunForChatFn,
  type SubagentWiringDeps,
  type BuildSubagentProviderRunForChatArgs,
} from "./claude-subagent-wiring"
import { OrchestrationQueue, type WorkerResult, type WorkerSpawnArgs } from "./orchestration-queue"
import { createOrchWorktreeOps } from "./orchestration-worktree.adapter"
import { runCommandInWorktree } from "./orchestration-exec-io.adapter"
import type { OrchRunDetail, OrchRunInput } from "../shared/orchestration-types"
import type { ToolCallbackService } from "./tool-callback"
import type { ChatPermissionPolicy } from "../shared/permission-policy"
import { POLICY_DEFAULT } from "../shared/permission-policy"
import {
  LOOP_BLOCKED_NATIVE_TOOLS,
  buildCanUseTool,
  buildClaudeEnv,
  type BuildCanUseToolArgs,
} from "./claude-spawn-helpers"
export { LOOP_BLOCKED_NATIVE_TOOLS, buildCanUseTool, buildClaudeEnv, type BuildCanUseToolArgs }
import { startClaudeSessionPTY, type StartClaudeSessionPtyArgs } from "./claude-pty/driver"
import { ensureFreshMcpToken } from "./mcp-oauth.adapter"
import {
  type ClaudeSessionConfigHelpersDeps,
  resolveClaudeDriverPreference as resolveClaudeDriverPreferenceFn,
  getEnabledCustomMcpServers as getEnabledCustomMcpServersFn,
  buildOAuthBearers as buildOAuthBearersFn,
  resolveChatPolicy as resolveChatPolicyFn,
  killPtyInstance as killPtyInstanceFn,
} from "./claude-session-config-helpers"
import type { AnyValue } from "../shared/errors"
import {
  timestamped,
  type ClaudeRawSdkMessage,
  getClaudeAssistantMessageUsageId,
  normalizeClaudeStreamMessage,
} from "./claude-message-normalizer"
export { timestamped, type ClaudeRawSdkMessage, getClaudeAssistantMessageUsageId, normalizeClaudeStreamMessage }
import {
  normalizeClaudeUsageSnapshot,
  resolveFinalTurnUsage,
  maxClaudeContextWindowFromModelUsage,
  parseConfiguredContextWindowFromModelId,
} from "./claude-usage-math"
export { normalizeClaudeUsageSnapshot, resolveFinalTurnUsage, maxClaudeContextWindowFromModelUsage, parseConfiguredContextWindowFromModelId }
import { createClaudeHarnessStream } from "./claude-harness-stream"
export { createClaudeHarnessStream }
import {
  buildUserMcpServers,
  buildTaskNotification,
  resolveSpawnPaths,
  resolveStackProjects,
  CLAUDE_TOOLSET,
} from "./claude-session-config"
export { buildUserMcpServers, buildTaskNotification, resolveSpawnPaths, resolveStackProjects, CLAUDE_TOOLSET }
import {
  buildAttachmentHintText,
  buildPromptText,
  toSdkEffort,
  backgroundTaskIdsFromToolResult,
  positiveIntegerFromEnv,
} from "./claude-prompt-helpers"
export {
  buildAttachmentHintText,
  buildPromptText,
  toSdkEffort,
  backgroundTaskIdsFromToolResult,
}
import {
  type SendMessageOptions,
  type SendToStartingProfile,
} from "./claude-steer-log"
import type { ActiveTurn, ClaudeSessionState } from "./claude-session-state"
import { runClaudeSession as runClaudeSessionLoop, type RunClaudeSessionDeps } from "./claude-session-runner"
import {
  startTurnForChat as startTurnForChatFn,
  type StartTurnDeps,
} from "./claude-turn-starter"
import { runTurn as runTurnFn, type RunTurnDeps } from "./claude-turn-runner"
import { spawnClaudeTurn, type SpawnClaudeTurnArgs, type SpawnClaudeTurnDeps } from "./claude-session-spawner"
import {
  resolveClaudeIdleMs as resolveClaudeIdleMsFn,
  hasLiveWorkflow as hasLiveWorkflowFn,
  hasPendingBackgroundTask as hasPendingBackgroundTaskFn,
  closeClaudeSession as closeClaudeSessionFn,
  maybeRegisterSdkWorkflowsDir as maybeRegisterSdkWorkflowsDirFn,
  enforceClaudeSessionBudget as enforceClaudeSessionBudgetFn,
  buildPoolUnavailableMessage as buildPoolUnavailableMessageFn,
  type SessionLifecycleDeps,
} from "./claude-session-lifecycle"
import {
  handleLimitError as handleLimitErrorFn,
  handleLimitDetection as handleLimitDetectionFn,
  handleAuthFailure as handleAuthFailureFn,
  type SessionErrorHandlerDeps,
  type TokenRotationDedupeEntry,
} from "./claude-session-error-handler"
import {
  resolveAutoResumeFor as resolveAutoResumeForFn,
  emitAutoContinueEvent as emitAutoContinueEventFn,
  fireAutoContinue as fireAutoContinueFn,
  acceptAutoContinue as acceptAutoContinueFn,
  rescheduleAutoContinue as rescheduleAutoContinueFn,
  cancelAutoContinue as cancelAutoContinueFn,
  type AutoContinueCommandDeps,
} from "./claude-autocontinue-commands"
import {
  buildOrchWorker as buildOrchWorkerFn,
  runOrchestration as runOrchestrationFn,
  cancelOrchRun as cancelOrchRunFn,
  getOrchRunDetail as getOrchRunDetailFn,
  deliverSubagentToMain as deliverSubagentToMainFn,
  setupLoop as setupLoopFn,
  isLoopArmed as isLoopArmedFn,
  stopLoop as stopLoopFn,
  listLiveSchedules as listLiveSchedulesFn,
  type LoopOrchCommandDeps,
} from "./claude-loop-orch-commands"
import {
  cancelChat as cancelChatFn,
  type CancelHandlerDeps,
} from "./claude-cancel-handler"
import {
  stopDraining as stopDrainingFn,
  closeChat as closeChatFn,
  steer as steerFn,
  dequeue as dequeueFn,
  forkChat as forkChatFn,
  generateTitleInBackground as generateTitleInBackgroundFn,
  type ChatManagementDeps,
} from "./claude-chat-management"
import {
  respondTool as respondToolFn,
  type ToolRespondDeps,
} from "./claude-tool-respond"
import {
  sendCommand as sendCommandFn,
  enqueueMessage as enqueueMessageFn,
  dequeueAndStartQueuedMessage as dequeueAndStartQueuedMessageFn,
  maybeStartNextQueuedMessage as maybeStartNextQueuedMessageFn,
  type SendCommandDeps,
} from "./claude-send-command"
import {
  ensureSlashCommandsLoaded as ensureSlashCommandsLoadedFn,
  mergeLocalCatalog as mergeLocalCatalogFn,
  type SlashCommandsDeps,
} from "./claude-slash-commands"
import {
  subagentPendingKey as subagentPendingKeyFn,
  rejectPendingResolversForChat as rejectPendingResolversForChatFn,
  rejectPendingResolversForRun as rejectPendingResolversForRunFn,
  respondSubagentTool as respondSubagentToolFn,
  cancelSubagentRun as cancelSubagentRunFn,
  type SubagentToolResponseDeps,
} from "./claude-subagent-tool-response"
import {
  getActiveStatuses as getActiveStatusesFn,
  getWaitStartedAtByChatId as getWaitStartedAtByChatIdFn,
  getPendingTool as getPendingToolFn,
  getDrainingChatIds as getDrainingChatIdsFn,
  getSlashCommandsLoadingChatIds as getSlashCommandsLoadingChatIdsFn,
  getClaudeSessionStates as getClaudeSessionStatesFn,
  sweepIdleClaudeSessions as sweepIdleClaudeSessionsFn,
  type SessionStateQueryDeps,
} from "./claude-session-state-queries"

export type { ClaudeSessionHandle } from "./harness-types"

interface ClaudeSessionLifecycleOptions {
  idleMs: number
  maxResidentSessions: number
  sweepIntervalMs: number
  // Max time a warm PTY session is held open solely because a background Bash
  // task is still pending (no other activity). Bounds a hung/never-completing
  // task so it cannot pin a process forever. See
  // adr-20260604-pty-background-task-keepalive.
  backgroundTaskMaxMs: number
}

interface AgentCoordinatorArgs {
  store: EventStore
  onStateChange: (chatId?: string, options?: { immediate?: boolean }) => void
  analytics?: AnalyticsReporter
  codexManager?: CodexAppServerManager
  generateTitle?: (messageContent: string, cwd: string) => Promise<GenerateChatTitleResult>
  tunnelGateway?: TunnelGateway
  startClaudeSession?: (args: {
    projectId: string
    localPath: string
    model: string
    effort?: string
    planMode: boolean
    sessionToken: string | null
    forkSession: boolean
    oauthToken: string | null
    additionalDirectories?: string[]
    chatId?: string
    tunnelGateway?: TunnelGateway | null
    onToolRequest: (request: HarnessToolRequest) => Promise<AnyValue>
    /**
     * Append text for the claude_code preset's `systemPrompt.append`.
     * Defaults to the static refusal-policy blurb; production callers in
     * `agent.ts` pass the dynamic value from `buildKannaSystemPromptAppend`
     * so the subagent roster is embedded.
     */
    systemPromptAppend?: string
    /** When set, redirect the SDK to OpenRouter instead of Anthropic. */
    openrouterApiKey?: string | null
    /** Orchestrator for delegate_subagent. Omit to hide the tool. */
    subagentOrchestrator?: SubagentOrchestrator
    /** Per-spawn delegation context (depth / ancestor chain / parentUserMessageId resolver). */
    delegationContext?: KannaMcpDelegationContext
    /**
     * Subagent-only override. When set, REPLACES the claude_code preset
     * append on systemPrompt entirely. Primary chats leave this unset.
     */
    systemPromptOverride?: string
    /**
     * Subagent-only one-shot prompt. When set, the SDK queue is primed with
     * this prompt and closed immediately so the session terminates after the
     * single turn. Primary chats leave this unset and call sendPrompt later.
     */
    initialPrompt?: string
    /** Routes AskUserQuestion/ExitPlanMode through tool-callback when KANNA_MCP_TOOL_CALLBACKS=1. */
    toolCallback?: ToolCallbackService
    /** Per-chat permission policy. Defaults to POLICY_DEFAULT if omitted. */
    chatPolicy?: ChatPermissionPolicy
    /** Enabled user MCP servers, merged into the SDK's mcpServers map. */
    customMcpServers?: readonly McpServerConfig[]
    /** Pre-resolved oauth bearer tokens keyed by server id. */
    oauthBearers?: ReadonlyMap<string, string>
    /** Folder-restricted subagent: disallow native FS tools + allowlist mcp__kanna__* + per-run path-deny scope. */
    restrictedAllowedPaths?: string[]
    /** Backs the `setup_loop` MCP tool. Omit to hide the tool. */
    setupLoop?: (input: LoopSetupInput) => Promise<SetupLoopHandlerResult>
    /** Backs the `stop_loop` MCP tool. Omit to hide the tool. */
    stopLoop?: () => Promise<void>
    /** Live check: true while an autonomous loop is armed — blocks direct-edit native tools. */
    isLoopArmed?: () => boolean
    /** Backs the `orch_run` / `orch_run_status` / `orch_cancel_run` MCP tools. Main-chat only. */
    runOrch?: (input: OrchRunInput) => Promise<{ ok: true; runId: string } | { ok: false; errors: string[] }>
    cancelOrchRun?: (runId: string) => Promise<void>
    getOrchRunStatus?: (runId: string) => OrchRunDetail | null
    /** Keep the SDK prompt queue open after the initial prompt to allow multi-turn keep-alive. */
    keepAlive?: boolean
    /** Per-turn price for computing cost when the provider doesn't report it (OpenRouter). */
    turnPrice?: ModelPrice | null
    /** Overrides the configured context window (OpenRouter model contextLength). */
    contextWindowOverride?: number
  }) => Promise<ClaudeSessionHandle>
  startClaudeSessionPTY?: (args: StartClaudeSessionPtyArgs) => Promise<ClaudeSessionHandle>
  claudeLimitDetector?: LimitDetector
  codexLimitDetector?: LimitDetector
  scheduleManager?: ScheduleManager
  getAutoResumePreference?: () => boolean
  /**
   * Watchdog (ms) for an OpenRouter turn whose SDK stream emits no transcript
   * entry (no `system_init`) after the session-token handshake. OpenRouter
   * routes through the Claude SDK; a stalled upstream leaves the stream open
   * but silent, so the `runClaudeSession` for-await never returns or throws
   * and the existing fail-close never fires. On timeout the watchdog
   * interrupts + closes the session so the stream ends and the turn is
   * recorded failed. OpenRouter-only; cleared on the first entry. Default
   * 120000 (2 min).
   */
  openrouterFirstEntryTimeoutMs?: number
  getSubagents?: () => Subagent[]
  getAppSettingsSnapshot?: () => {
    claudeAuth?: { authenticated?: boolean } | null
    claudeDriver?: {
      preference?: ClaudeDriverPreference
      lifecycle?: { idleTimeoutMs?: number; maxConcurrent?: number }
    }
    globalPromptAppend?: string
    customMcpServers?: readonly McpServerConfig[]
    customModels?: readonly CustomModelEntry[]
    subagentRuntime?: { runTimeoutMs?: number; defaultLoopSubagentId?: string | null; defaultOrchSubagentId?: string | null }
  }
  throwOnClaudeSessionStart?: boolean
  oauthPool?: OAuthTokenPool
  /** Populated on boot; will be consumed by canUseTool in Task 11. */
  toolCallback?: ToolCallbackService
  /** Per-chat permission policy forwarded to startClaudeSession. Defaults to POLICY_DEFAULT if omitted. */
  chatPolicy?: ChatPermissionPolicy
  /** Claude subprocess lifecycle tuning. Defaults are conservative and may be overridden in tests. */
  claudeSessionLifecycle?: Partial<ClaudeSessionLifecycleOptions>
  /** On-disk registry of claude PTY children for crash-orphan reap on next boot. Forwarded to every PTY spawn. */
  claudePtyRegistry?: import("./claude-pty/pid-registry.adapter").ClaudePtyRegistry
  /** In-memory live-status registry surfaced to the UI. Forwarded to every PTY spawn. */
  ptyInstanceRegistry?: import("./claude-pty/pty-instance-registry").PtyInstanceRegistry
  /** Registry of workflow runs per chat, populated by PTY driver from the on-disk workflows dir. */
  workflowRegistry?: import("./workflow-registry").WorkflowRegistry
  /** Registry mapping each chat to its `…/subagents` dir for on-demand Agent child-transcript drill-in. */
  subagentTranscriptRegistry?: import("./subagent-transcript-registry").SubagentTranscriptRegistry
  /** Reads the persisted LLM provider snapshot (OpenRouter key source). */
  readLlmProvider?: () => Promise<LlmProviderSnapshot>
  /** Lists OpenRouter models (with pricing + contextLength) for cost computation. */
  listOpenRouterModels?: () => Promise<import("../shared/types").OpenRouterModel[]>
  /** Local skill + slash command catalog (user, project, plugin scans). */
  localCatalog?: import("./local-catalog").LocalCatalogService
  /** Persist updated OAuth state for a custom MCP server (called after token refresh at spawn). */
  persistOAuthState?: (id: string, oauth: McpOAuthState) => void
}


const DEFAULT_CLAUDE_SESSION_IDLE_MS = 10 * 60 * 1000
const DEFAULT_CLAUDE_SESSION_MAX_RESIDENT = 4
const DEFAULT_CLAUDE_SESSION_SWEEP_INTERVAL_MS = 60 * 1000
// Keep a PTY session warm up to 30 min while a background Bash task is pending —
// comfortably longer than the 10-min idle window and typical CI durations.
const DEFAULT_PTY_BACKGROUND_TASK_MAX_MS = 30 * 60 * 1000
// OpenRouter-only watchdog: a stalled upstream leaves the SDK stream open but
// silent after the session-token handshake, so the runClaudeSession for-await
// never ends and the existing fail-close never fires. Abort if no transcript
// entry arrives within this window. system_init is the SDK init echo (precedes
// model inference), so 2 min is generous; env-tunable per deployment.
const DEFAULT_OPENROUTER_FIRST_ENTRY_TIMEOUT_MS = 2 * 60 * 1000

// Thrown by Claude spawn paths when the OAuth pool has tokens but every one
// is currently unusable (rate-limited, errored, disabled, or reserved by
// another chat). `startTurnForChat` catches this and persists `message` as a
// `result` transcript entry instead of letting it surface as an ephemeral
// commandError that gets wiped by the next chat snapshot tick.
// Moved to oauth-errors.ts to avoid a circular import with claude-turn-starter.ts.
import { OAuthPoolUnavailableError } from "./oauth-errors"
export { OAuthPoolUnavailableError }

export class AgentCoordinator {
  private readonly store: EventStore
  private readonly onStateChange: (chatId?: string, options?: { immediate?: boolean }) => void
  private readonly analytics: AnalyticsReporter
  private readonly codexManager: CodexAppServerManager
  private readonly generateTitle: (messageContent: string, cwd: string) => Promise<GenerateChatTitleResult>
  private readonly startClaudeSessionFn: NonNullable<AgentCoordinatorArgs["startClaudeSession"]>
  private readonly startClaudeSessionPTYFn: (args: StartClaudeSessionPtyArgs) => Promise<ClaudeSessionHandle>
  private reportBackgroundError: ((message: string) => void) | null = null
  readonly activeTurns = new Map<string, ActiveTurn>()
  readonly drainingStreams = new Map<string, { turn: HarnessTurn }>()
  readonly claudeSessions = new Map<string, ClaudeSessionState>()
  private readonly mentionedSubagentIdsByChat = new Map<string, string[]>()
  private readonly slashCommandsInFlight = new Set<string>()
  private readonly claudeLimitDetector: LimitDetector
  private readonly codexLimitDetector: LimitDetector
  private readonly claudeAuthErrorDetector: ClaudeAuthErrorDetector
  private readonly scheduleManager: ScheduleManager | null
  private readonly getAutoResumePreference: () => boolean
  private readonly getSubagents: () => Subagent[]
  private readonly getAppSettingsSnapshot: NonNullable<AgentCoordinatorArgs["getAppSettingsSnapshot"]>
  private readonly subagentOrchestrator: SubagentOrchestrator
  /** Public accessor for tests + the `delegate_subagent` MCP tool wiring. */
  getSubagentOrchestrator(): SubagentOrchestrator {
    return this.subagentOrchestrator
  }
  private readonly orchestrationQueue: OrchestrationQueue
  /** Public accessor for tests + the `orch_*` MCP tool + ws-router wiring. */
  getOrchestrationQueue(): OrchestrationQueue {
    return this.orchestrationQueue
  }
  private readonly throwOnClaudeSessionStart: boolean
  private readonly autoResumeByChat = new Map<string, boolean>()
  private readonly openrouterFirstEntryTimeoutMs: number
  // Per-tokenId rotation dedupe state. When a shared OAuth token throws
  // limit/auth-error against N chats simultaneously, only the first chat
  // pays the cost of marking the pool + picking a fresh target; subsequent
  // chats within TOKEN_ROTATION_DEDUPE_WINDOW_MS reuse the dedupe slot to
  // stagger their respawns by TOKEN_ROTATION_HERD_STAGGER_MS each.
  private readonly tokenRotationDedupe = new Map<string, TokenRotationDedupeEntry>()
  // Per-chat circuit breaker for proactive `/compact` injection lives in the
  // persisted ChatRecord (`compactFailureCount`): increments on every compact
  // attempt that fails (turn errored / cancelled) and resets on success.
  // After MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES, skip further proactive
  // compacts on this chat so doomed sessions don't hammer the API on every
  // turn (mirrors claude-code's autoCompact circuit breaker). Persisting it
  // means a server restart cannot reset a doomed chat's breaker to 0.
  private readonly tunnelGateway: TunnelGateway | null
  private readonly oauthPool: OAuthTokenPool | null
  private readonly toolCallback: ToolCallbackService | null
  private readonly chatPolicy: ChatPermissionPolicy
  private readonly claudeSessionLifecycle: ClaudeSessionLifecycleOptions
  private readonly claudeSessionSweepTimer: ReturnType<typeof setInterval> | null
  private readonly claudePtyRegistry: import("./claude-pty/pid-registry.adapter").ClaudePtyRegistry | null
  private readonly ptyInstanceRegistry: import("./claude-pty/pty-instance-registry").PtyInstanceRegistry | null
  private readonly workflowRegistry: import("./workflow-registry").WorkflowRegistry | null
  private readonly subagentTranscriptRegistry: import("./subagent-transcript-registry").SubagentTranscriptRegistry | null
  private readonly localCatalog: import("./local-catalog").LocalCatalogService | null
  private readonly readLlmProvider: () => Promise<LlmProviderSnapshot>
  private readonly listOpenRouterModelsFn: (() => Promise<import("../shared/types").OpenRouterModel[]>) | null
  private readonly persistOAuthStateFn: ((id: string, oauth: McpOAuthState) => void) | null
  private readonly subagentPendingResolvers = new Map<
    string,
    { resolve: (v: AnyValue) => void; reject: (e: Error) => void }
  >()

  constructor(args: AgentCoordinatorArgs) {
    this.store = args.store
    this.onStateChange = args.onStateChange
    this.analytics = args.analytics ?? NoopAnalyticsReporter
    this.codexManager = args.codexManager ?? new CodexAppServerManager()
    this.generateTitle = args.generateTitle ?? generateTitleForChatDetailed
    this.startClaudeSessionFn = args.startClaudeSession ?? startClaudeSession
    this.startClaudeSessionPTYFn = args.startClaudeSessionPTY ?? startClaudeSessionPTY
    this.claudeLimitDetector = args.claudeLimitDetector ?? new ClaudeLimitDetector()
    this.codexLimitDetector = args.codexLimitDetector ?? new CodexLimitDetector()
    this.claudeAuthErrorDetector = new ClaudeAuthErrorDetector()
    this.scheduleManager = args.scheduleManager ?? null
    this.getAutoResumePreference = args.getAutoResumePreference ?? (() => false)
    this.openrouterFirstEntryTimeoutMs =
      args.openrouterFirstEntryTimeoutMs ?? DEFAULT_OPENROUTER_FIRST_ENTRY_TIMEOUT_MS
    this.getSubagents = args.getSubagents ?? (() => [])
    this.getAppSettingsSnapshot = args.getAppSettingsSnapshot ?? (() => ({}))
    this.readLlmProvider = args.readLlmProvider ?? readLlmProviderSnapshot
    this.listOpenRouterModelsFn = args.listOpenRouterModels ?? null
    this.persistOAuthStateFn = args.persistOAuthState ?? null
    this.subagentOrchestrator = new SubagentOrchestrator({
      store: this.store,
      appSettings: { getSnapshot: () => ({ subagents: this.getSubagents() }) },
      startProviderRun: (a) => this.buildSubagentProviderRunForChat({
        subagent: a.subagent,
        chatId: a.chatId,
        primer: a.primer,
        userInstruction: a.userInstruction,
        runId: a.runId,
        abortSignal: a.abortSignal,
        depth: a.depth,
        ancestorSubagentIds: a.ancestorSubagentIds,
        parentUserMessageId: a.parentUserMessageId,
      }),
      onRunTerminal: (chatId, runId) => {
        this.rejectPendingResolversForRun(chatId, runId)
        // failRun appended the terminal event synchronously before invoking
        // this hook, so the store already has the new state. Emit now so
        // multi-subagent fan-outs do not have to wait for Promise.all.
        this.emitStateChange(chatId)
      },
      onRunProgress: (chatId) => {
        // Run start + every persisted subagent entry. Without this the
        // client only gets a snapshot at terminal, so a delegated run
        // renders blank until it finishes (delegate_subagent blocks the
        // main turn, which itself emits nothing meanwhile). ws-router
        // coalesces (16ms) and signature-dedups, so per-entry fan-out is
        // cheap.
        this.emitStateChange(chatId)
      },
      onBackgroundRunComplete: (chatId, runId, outcome) => {
        void this.deliverSubagentToMain(chatId, runId, outcome)
      },
      maxLive: positiveIntegerFromEnv(process.env.KANNA_SUBAGENT_MAX_LIVE, 0) || undefined,
      liveIdleTimeoutMs: positiveIntegerFromEnv(process.env.KANNA_SUBAGENT_IDLE_TIMEOUT_MS, 0) || undefined,
      // Stall/idle watchdog window. Precedence: app setting > env > orchestrator
      // default. The orchestrator reads this once at construction; a settings
      // change takes effect on next server start (acceptable — restart-scoped).
      runTimeoutMs: (this.getAppSettingsSnapshot().subagentRuntime?.runTimeoutMs
        ?? positiveIntegerFromEnv(process.env.KANNA_SUBAGENT_RUN_TIMEOUT_MS, 0))
        || undefined,
    })
    this.orchestrationQueue = new OrchestrationQueue({
      store: this.store,
      worktrees: createOrchWorktreeOps(),
      startWorker: (a) => this.buildOrchWorker(a),
      runVerify: runCommandInWorktree,
      runInit: runCommandInWorktree,
    })
    this.throwOnClaudeSessionStart = args.throwOnClaudeSessionStart ?? false
    this.tunnelGateway = args.tunnelGateway ?? null
    this.oauthPool = args.oauthPool ?? null
    this.toolCallback = args.toolCallback ?? null
    this.chatPolicy = args.chatPolicy ?? POLICY_DEFAULT
    this.claudeSessionLifecycle = {
      idleMs: args.claudeSessionLifecycle?.idleMs
        ?? positiveIntegerFromEnv(process.env.KANNA_CLAUDE_SESSION_IDLE_MS, DEFAULT_CLAUDE_SESSION_IDLE_MS),
      maxResidentSessions: args.claudeSessionLifecycle?.maxResidentSessions
        ?? positiveIntegerFromEnv(process.env.KANNA_CLAUDE_SESSION_MAX_RESIDENT, DEFAULT_CLAUDE_SESSION_MAX_RESIDENT),
      sweepIntervalMs: args.claudeSessionLifecycle?.sweepIntervalMs
        ?? positiveIntegerFromEnv(process.env.KANNA_CLAUDE_SESSION_SWEEP_INTERVAL_MS, DEFAULT_CLAUDE_SESSION_SWEEP_INTERVAL_MS),
      backgroundTaskMaxMs: args.claudeSessionLifecycle?.backgroundTaskMaxMs
        ?? positiveIntegerFromEnv(process.env.KANNA_PTY_BACKGROUND_TASK_MAX_MS, DEFAULT_PTY_BACKGROUND_TASK_MAX_MS),
    }
    this.claudeSessionSweepTimer = this.claudeSessionLifecycle.sweepIntervalMs > 0
      ? setInterval(() => { this.sweepIdleClaudeSessions() }, this.claudeSessionLifecycle.sweepIntervalMs)
      : null
    this.claudeSessionSweepTimer?.unref?.()
    this.claudePtyRegistry = args.claudePtyRegistry ?? null
    this.ptyInstanceRegistry = args.ptyInstanceRegistry ?? null
    this.workflowRegistry = args.workflowRegistry ?? null
    this.subagentTranscriptRegistry = args.subagentTranscriptRegistry ?? null
    this.localCatalog = args.localCatalog ?? null
  }

  setBackgroundErrorReporter(report: ((message: string) => void) | null) {
    this.reportBackgroundError = report
  }

  dispose() {
    if (this.claudeSessionSweepTimer) clearInterval(this.claudeSessionSweepTimer)
    for (const [chatId, session] of [...this.claudeSessions.entries()]) {
      this.closeClaudeSession(chatId, session)
    }
  }

  getActiveStatuses() {
    return getActiveStatusesFn(this.buildSessionStateQueryDeps())
  }

  getWaitStartedAtByChatId(): Map<string, number> {
    return getWaitStartedAtByChatIdFn(this.buildSessionStateQueryDeps())
  }

  getPendingTool(chatId: string): PendingToolSnapshot | null {
    return getPendingToolFn(this.buildSessionStateQueryDeps(), chatId)
  }

  getDrainingChatIds(): Set<string> {
    return getDrainingChatIdsFn(this.buildSessionStateQueryDeps())
  }

  getSlashCommandsLoadingChatIds(): Set<string> {
    return getSlashCommandsLoadingChatIdsFn(this.buildSessionStateQueryDeps())
  }

  /**
   * Snapshot of live claude PTY session states per chat. Used by the
   * sidebar badge selector. Chats not present are implicitly `cold`.
   */
  getClaudeSessionStates(): Map<string, "warming" | "active" | "idle"> {
    return getClaudeSessionStatesFn(this.buildSessionStateQueryDeps())
  }

  get toolCallbackService(): ToolCallbackService | null {
    return this.toolCallback
  }

  private emitStateChange(chatId?: string, options?: { immediate?: boolean }) {
    this.onStateChange(chatId, options)
  }

  // ---------------------------------------------------------------------------
  // Session config helpers deps builder
  // ---------------------------------------------------------------------------

  private buildClaudeSessionConfigHelpersDeps(): ClaudeSessionConfigHelpersDeps {
    return {
      getAppSettingsSnapshot: () => this.getAppSettingsSnapshot(),
      chatPolicy: this.chatPolicy,
      store: this.store,
      ptyInstanceRegistry: this.ptyInstanceRegistry,
      ensureFreshToken: (server, opts) => ensureFreshMcpToken(server, opts),
      persistOAuthState: this.persistOAuthStateFn,
      killProcessTree: async (pid) => {
        const { killProcessTree } = await import("./claude-pty/pid-registry.adapter")
        await killProcessTree(pid)
      },
    }
  }

  private resolveClaudeDriverPreference(): ClaudeDriverPreference {
    return resolveClaudeDriverPreferenceFn(this.buildClaudeSessionConfigHelpersDeps())
  }

  private getEnabledCustomMcpServers(): readonly McpServerConfig[] {
    return getEnabledCustomMcpServersFn(this.buildClaudeSessionConfigHelpersDeps())
  }

  private async buildOAuthBearers(servers: readonly McpServerConfig[]): Promise<Map<string, string>> {
    return buildOAuthBearersFn(this.buildClaudeSessionConfigHelpersDeps(), servers)
  }

  private resolveChatPolicy(chatId: string): ChatPermissionPolicy {
    return resolveChatPolicyFn(this.buildClaudeSessionConfigHelpersDeps(), chatId)
  }

  // ---------------------------------------------------------------------------
  // Session lifecycle deps builder — wires this.* refs into SessionLifecycleDeps
  // ---------------------------------------------------------------------------

  private buildSessionLifecycleDeps(): SessionLifecycleDeps {
    return {
      getAppSettingsSnapshot: () => this.getAppSettingsSnapshot(),
      defaultIdleMs: this.claudeSessionLifecycle.idleMs,
      defaultMaxResidentSessions: this.claudeSessionLifecycle.maxResidentSessions,
      claudeSessions: this.claudeSessions,
      activeTurns: this.activeTurns,
      oauthPool: this.oauthPool,
      workflowRegistry: this.workflowRegistry,
      resolveClaudeDriverPreference: () => this.resolveClaudeDriverPreference(),
      emitStateChange: (chatId: string) => { this.emitStateChange(chatId) },
      store: this.store,
      homeDir: homedir(),
    }
  }

  private buildSessionErrorHandlerDeps(): SessionErrorHandlerDeps {
    return {
      tokenRotationDedupe: this.tokenRotationDedupe,
      claudeSessions: this.claudeSessions,
      activeTurns: this.activeTurns,
      oauthPool: this.oauthPool,
      store: this.store,
      resolveAutoResumeFor: (chatId: string) => this.resolveAutoResumeFor(chatId),
      emitAutoContinueEvent: (event: AutoContinueEvent) => this.emitAutoContinueEvent(event),
      closeClaudeSession: (chatId: string, session: ClaudeSessionState, opts?: { keepReservation?: boolean }) =>
        this.closeClaudeSession(chatId, session, opts),
    }
  }

  // ---------------------------------------------------------------------------
  // Auto-continue command deps builder — wires this.* refs into AutoContinueCommandDeps
  // ---------------------------------------------------------------------------

  private buildAutoContinueCommandDeps(): AutoContinueCommandDeps {
    return {
      autoResumeByChat: this.autoResumeByChat,
      getAutoResumePreference: () => this.getAutoResumePreference(),
      store: this.store,
      scheduleManager: this.scheduleManager,
      emitStateChange: (chatId: string) => { this.emitStateChange(chatId) },
      enqueueMessage: (chatId, content, attachments, options) =>
        this.enqueueMessage(chatId, content, attachments, options),
      maybeStartNextQueuedMessage: (chatId) => this.maybeStartNextQueuedMessage(chatId),
    }
  }

  private buildLoopOrchCommandDeps(): LoopOrchCommandDeps {
    return {
      store: this.store,
      orchestrationQueue: this.orchestrationQueue,
      claudeSessions: this.claudeSessions,
      activeTurns: this.activeTurns,
      getSubagents: () => this.getSubagents(),
      getAppSettingsSnapshot: () => this.getAppSettingsSnapshot(),
      buildSubagentProviderRunForChat: (args) => this.buildSubagentProviderRunForChat(args),
      closeClaudeSession: (chatId, session) => this.closeClaudeSession(chatId, session),
      emitAutoContinueEvent: (event) => this.emitAutoContinueEvent(event),
      ensureTrackingFile,
    }
  }

  // ---------------------------------------------------------------------------
  // Cancel handler deps builder — wires this.* refs into CancelHandlerDeps
  // ---------------------------------------------------------------------------

  private buildCancelHandlerDeps(): CancelHandlerDeps {
    return {
      drainingStreams: this.drainingStreams,
      rejectPendingResolversForChat: (chatId) => this.rejectPendingResolversForChat(chatId),
      cancelChatInOrchestrator: (chatId) => this.subagentOrchestrator.cancelChat(chatId),
      activeTurns: this.activeTurns,
      store: this.store,
      claudeSessions: this.claudeSessions,
      emitStateChange: (chatId) => this.emitStateChange(chatId),
      resolveClaudeDriverPreference: () => this.resolveClaudeDriverPreference(),
      closeClaudeSession: (chatId, session) => this.closeClaudeSession(chatId, session),
      maybeStartNextQueuedMessage: async (chatId) => { await this.maybeStartNextQueuedMessage(chatId) },
    }
  }

  // ---------------------------------------------------------------------------
  // Chat management deps builder — wires this.* refs into ChatManagementDeps
  // ---------------------------------------------------------------------------

  private buildChatManagementDeps(): ChatManagementDeps {
    return {
      activeTurns: this.activeTurns,
      drainingStreams: this.drainingStreams,
      claudeSessions: this.claudeSessions,
      autoResumeByChat: this.autoResumeByChat,
      store: this.store,
      analytics: this.analytics,
      cancel: (chatId, options) => this.cancel(chatId, options),
      closeClaudeSession: (chatId, session, opts) => this.closeClaudeSession(chatId, session, opts),
      emitStateChange: (chatId) => this.emitStateChange(chatId),
      generateTitle: (messageContent, cwd) => this.generateTitle(messageContent, cwd),
      reportBackgroundError: this.reportBackgroundError,
      dequeueAndStartQueuedMessage: (chatId, queuedMessage, options) =>
        this.dequeueAndStartQueuedMessage(chatId, queuedMessage, options),
    }
  }

  // ---------------------------------------------------------------------------
  // Send command deps builder — wires this.* refs into SendCommandDeps
  // ---------------------------------------------------------------------------

  private buildSendCommandDeps(): SendCommandDeps {
    return {
      store: this.store,
      activeTurns: this.activeTurns,
      claudeSessions: this.claudeSessions,
      autoResumeByChat: this.autoResumeByChat,
      analytics: this.analytics,
      getAppSettingsSnapshot: () => this.getAppSettingsSnapshot(),
      stopLoop: (chatId, reason) => this.stopLoop(chatId, reason),
      emitStateChange: (chatId) => this.emitStateChange(chatId),
      startTurnForChat: (args) => this.startTurnForChat(args),
    }
  }

  // ---------------------------------------------------------------------------
  // Subagent wiring deps builder — wires this.* refs into SubagentWiringDeps
  // ---------------------------------------------------------------------------

  private buildSubagentWiringDeps(): SubagentWiringDeps {
    return {
      store: this.store,
      startClaudeSessionFn: this.startClaudeSessionFn,
      startClaudeSessionPTYFn: this.startClaudeSessionPTYFn,
      toolCallback: this.toolCallback,
      tunnelGateway: this.tunnelGateway,
      claudePtyRegistry: this.claudePtyRegistry,
      ptyInstanceRegistry: this.ptyInstanceRegistry,
      workflowRegistry: this.workflowRegistry,
      subagentOrchestrator: this.subagentOrchestrator,
      codexManager: this.codexManager,
      oauthPool: this.oauthPool,
      subagentPendingResolvers: this.subagentPendingResolvers,
      realpath: realpathAdapter,
      resolveClaudeDriverPreference: () => this.resolveClaudeDriverPreference(),
      getEnabledCustomMcpServers: () => this.getEnabledCustomMcpServers(),
      buildOAuthBearers: (servers) => this.buildOAuthBearers(servers),
      resolveChatPolicy: (chatId) => this.resolveChatPolicy(chatId),
      emitStateChange: (chatId) => { this.emitStateChange(chatId) },
      buildPoolUnavailableMessage: (reservedFor, scopeSuffix) =>
        this.buildPoolUnavailableMessage(reservedFor, scopeSuffix),
      getAppSettingsSnapshot: () => this.getAppSettingsSnapshot(),
      readLlmProvider: () => this.readLlmProvider(),
      subagentPendingKey: (chatId, runId, toolUseId) =>
        this.subagentPendingKey(chatId, runId, toolUseId),
    }
  }

  private buildSlashCommandsDeps(): SlashCommandsDeps {
    return {
      store: this.store,
      claudeSessions: this.claudeSessions,
      oauthPool: this.oauthPool,
      slashCommandsInFlight: this.slashCommandsInFlight,
      emitStateChange: (chatId) => { this.emitStateChange(chatId) },
      resolveClaudeDriverPreference: () => this.resolveClaudeDriverPreference(),
      startClaudeSessionPTY: this.startClaudeSessionPTYFn,
      startClaudeSessionSDK: this.startClaudeSessionFn,
      getSubagents: () => this.getSubagents(),
      getGlobalPromptAppend: () => this.getAppSettingsSnapshot().globalPromptAppend,
      getEnabledCustomMcpServers: () => this.getEnabledCustomMcpServers(),
      claudePtyRegistry: this.claudePtyRegistry,
      ptyInstanceRegistry: this.ptyInstanceRegistry,
      workflowRegistry: this.workflowRegistry,
      subagentTranscriptRegistry: this.subagentTranscriptRegistry,
      localCatalog: this.localCatalog,
    }
  }

  private resolveClaudeIdleMs(): number {
    return resolveClaudeIdleMsFn(this.buildSessionLifecycleDeps())
  }

  /**
   * True when the chat is hosting an in-flight background Workflow. A live
   * workflow runs inside the warm PTY claude process but registers no
   * activeTurn, pendingPromptSeq, or lastUsedAt bump, so without this signal
   * the idle reaper / budget enforcer would tear the process down mid-run and
   * abort the workflow.
   *
   * Liveness comes from the registry's live-run-dir probe, NOT the terminal
   * `wf_<runId>.json` sidecar: Claude only flushes that sidecar at/near
   * termination, so a sidecar-only check is blind for the entire run (the
   * window the guard must cover). `hasActiveRun` reads the live
   * `subagents/workflows/wf_*` transcript dirs (written from second one) and
   * requires activity within one idle window so a stalled/crashed run still
   * eventually reaps.
   */
  private hasLiveWorkflow(chatId: string): boolean {
    return hasLiveWorkflowFn(this.buildSessionLifecycleDeps(), chatId)
  }

  private resolveBackgroundTaskMaxMs(): number {
    return this.claudeSessionLifecycle.backgroundTaskMaxMs
  }

  /**
   * True while the session has at least one Claude-Code background Bash task
   * that has not yet settled. Primary gate is set size > 0: settle events
   * (task_notification) remove their id from the set, so the guard clears the
   * moment the last task reports. The deadline is a zombie backstop only —
   * it fires when a settle notification is genuinely lost (SDK crash / dropped
   * message) and is reset on every launch and settle, so it never expires
   * during normal execution regardless of task duration.
   */
  private hasPendingBackgroundTask(session: ClaudeSessionState, now: number): boolean {
    return hasPendingBackgroundTaskFn(session, now)
  }

  /**
   * Tear down a Claude session and (by default) release the OAuth-pool
   * reservation owned by the chat.
   *
   * `keepReservation: true` — used by rate-limit / auth-error rotation
   * paths that have ALREADY claimed a fresh token via `pickActive(chatId)`
   * before calling close. Without this flag, `release(chatId)` would
   * scan reservedBy for `owner === chatId` and drop the *new* token the
   * rotation just claimed, leaking the rotation's reservation (audit #9d).
   */
  private closeClaudeSession(
    chatId: string,
    session: ClaudeSessionState,
    opts?: { keepReservation?: boolean },
  ): void {
    closeClaudeSessionFn(this.buildSessionLifecycleDeps(), chatId, session, opts)
  }

  /**
   * Register the workflow disk-watch dir for an SDK session once the session
   * token is known. No-op if the registry is absent, already registered, or
   * the driver preference is PTY (the PTY driver registers from its own
   * resolved transcript path in driver.ts cleanup and must not be double-fired).
   */
  private maybeRegisterSdkWorkflowsDir(session: ClaudeSessionState): void {
    maybeRegisterSdkWorkflowsDirFn(this.buildSessionLifecycleDeps(), session)
  }

  private sweepIdleClaudeSessions(now = Date.now()): void {
    sweepIdleClaudeSessionsFn(this.buildSessionStateQueryDeps(), now)
  }

  private enforceClaudeSessionBudget(protectedChatId?: string): void {
    enforceClaudeSessionBudgetFn(this.buildSessionLifecycleDeps(), protectedChatId)
  }

  /**
   * Format a refusal message when `pickActive(chatId)` returned null but the
   * pool has tokens. Names the offending tokens so the user knows which
   * chat to close or which token to add a quota to, instead of seeing the
   * generic "all tokens unavailable" line that doesn't say what's holding
   * them. `scopeSuffix` lets the subagent path tag its variant.
   */
  private buildPoolUnavailableMessage(reservedFor: string, scopeSuffix: string): string {
    return buildPoolUnavailableMessageFn(this.buildSessionLifecycleDeps(), reservedFor, scopeSuffix)
  }

  private buildSubagentToolResponseDeps(): SubagentToolResponseDeps {
    return {
      subagentPendingResolvers: this.subagentPendingResolvers,
      store: this.store,
      subagentOrchestrator: this.subagentOrchestrator,
      emitStateChange: (chatId) => { this.emitStateChange(chatId) },
    }
  }

  private buildToolRespondDeps(): ToolRespondDeps {
    return {
      activeTurns: this.activeTurns,
      store: this.store,
      emitStateChange: (chatId) => { this.emitStateChange(chatId) },
    }
  }

  private buildSessionStateQueryDeps(): SessionStateQueryDeps {
    return {
      activeTurns: this.activeTurns,
      claudeSessions: this.claudeSessions,
      drainingStreams: this.drainingStreams,
      slashCommandsInFlight: this.slashCommandsInFlight,
      isClaudeSdkProvider: (provider) => isClaudeSdkProvider(provider),
      hasPendingBackgroundTask: (session, now) => this.hasPendingBackgroundTask(session, now),
      resolveClaudeIdleMs: () => this.resolveClaudeIdleMs(),
      hasLiveWorkflow: (chatId) => this.hasLiveWorkflow(chatId),
      closeClaudeSession: (chatId, session) => { this.closeClaudeSession(chatId, session) },
      emitStateChange: (chatId) => { this.emitStateChange(chatId) },
    }
  }

  private subagentPendingKey(chatId: string, runId: string, toolUseId: string): string {
    return subagentPendingKeyFn(chatId, runId, toolUseId)
  }

  private rejectPendingResolversForChat(chatId: string): void {
    rejectPendingResolversForChatFn({ subagentPendingResolvers: this.subagentPendingResolvers }, chatId)
  }

  private rejectPendingResolversForRun(chatId: string, runId: string): void {
    rejectPendingResolversForRunFn({ subagentPendingResolvers: this.subagentPendingResolvers }, chatId, runId)
  }

  getActiveTurnProfile(chatId: string): SendToStartingProfile | null {
    const active = this.activeTurns.get(chatId)
    if (!active?.clientTraceId || active.profilingStartedAt === undefined) {
      return null
    }

    return {
      traceId: active.clientTraceId,
      startedAt: active.profilingStartedAt,
    }
  }

  private clearDrainingStream(chatId: string): void {
    this.drainingStreams.delete(chatId)
  }

  async stopDraining(chatId: string) {
    return stopDrainingFn(this.buildChatManagementDeps(), chatId)
  }

  async ensureSlashCommandsLoaded(chatId: string): Promise<void> {
    return ensureSlashCommandsLoadedFn(this.buildSlashCommandsDeps(), chatId)
  }

  /** @internal used by agent-deps-builders.ts via buildRunClaudeSessionDeps / buildSpawnClaudeTurnDeps */
  mergeLocalCatalog(commands: SlashCommand[], cwd: string): SlashCommand[] {
    return mergeLocalCatalogFn(this.buildSlashCommandsDeps(), commands, cwd)
  }

  async closeChat(chatId: string) {
    return closeChatFn(this.buildChatManagementDeps(), chatId)
  }

  /** Delegates to enqueueMessageFn — see claude-send-command.ts. */
  private async enqueueMessage(chatId: string, content: string, attachments: ChatAttachment[], options?: SendMessageOptions) {
    return enqueueMessageFn(this.buildSendCommandDeps(), chatId, content, attachments, options)
  }

  /** Delegates to dequeueAndStartQueuedMessageFn — see claude-send-command.ts. */
  private async dequeueAndStartQueuedMessage(chatId: string, queuedMessage: QueuedChatMessage, options?: { steered?: boolean }) {
    return dequeueAndStartQueuedMessageFn(this.buildSendCommandDeps(), chatId, queuedMessage, options)
  }

  /** Delegates to maybeStartNextQueuedMessageFn — see claude-send-command.ts. */
  private async maybeStartNextQueuedMessage(chatId: string) {
    return maybeStartNextQueuedMessageFn(this.buildSendCommandDeps(), chatId)
  }

  private buildStartTurnDeps(): StartTurnDeps {
    return {
      activeTurns: this.activeTurns,
      claudeSessions: this.claudeSessions,
      drainingStreams: this.drainingStreams,
      mentionedSubagentIdsByChat: this.mentionedSubagentIdsByChat,
      store: this.store,
      codexManager: this.codexManager,
      subagentOrchestrator: this.subagentOrchestrator,
      clearDrainingStream: (chatId) => this.clearDrainingStream(chatId),
      emitStateChange: (chatId, opts) => this.emitStateChange(chatId, opts),
      resolveClaudeDriverPreference: () => this.resolveClaudeDriverPreference(),
      getSubagents: () => this.getSubagents(),
      getAppSettingsSnapshot: () => this.getAppSettingsSnapshot(),
      generateTitleInBackground: (chatId, content, localPath, optimisticTitle) =>
        this.generateTitleInBackground(chatId, content, localPath, optimisticTitle),
      recreateActiveTurnFromSession: (args) => this.recreateActiveTurnFromSession(args),
      startClaudeTurn: (args) => this.startClaudeTurn(args),
      findLastUserMessageId: (chatId) => this.findLastUserMessageId(chatId),
      runTurn: (active) => this.runTurn(active),
    }
  }

  private async startTurnForChat(args: {
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
    userClearedContext?: boolean
    profile?: SendToStartingProfile | null
  }) {
    return startTurnForChatFn(this.buildStartTurnDeps(), args)
  }


  private buildSessionRebuildDeps(): SessionRebuildDeps {
    return {
      claudeSessions: this.claudeSessions,
      activeTurns: this.activeTurns,
      providerUsesSdkSession,
      getMessages: (chatId) => this.store.getMessages(chatId),
    }
  }

  /** @internal used by agent-deps-builders.ts via buildStartTurnDeps */
  recreateActiveTurnFromSession(args: {
    chatId: string
    provider: AgentProvider
    model: string
    effort?: string
    serviceTier?: "fast"
    planMode: boolean
    clientTraceId?: string
  }): ActiveTurn | undefined {
    return recreateActiveTurnFromSessionFn(this.buildSessionRebuildDeps(), args)
  }

  /** @internal used by agent-deps-builders.ts via buildStartTurnDeps */
  findLastUserMessageId(chatId: string): string | null {
    return findLastUserMessageIdFn(this.buildSessionRebuildDeps(), chatId)
  }

  private buildSpawnClaudeTurnDeps(): SpawnClaudeTurnDeps {
    return {
      claudeSessions: this.claudeSessions,
      activeTurns: this.activeTurns,
      mentionedSubagentIdsByChat: this.mentionedSubagentIdsByChat,
      oauthPool: this.oauthPool,
      store: this.store,
      startClaudeSessionFn: this.startClaudeSessionFn,
      startClaudeSessionPTYFn: this.startClaudeSessionPTYFn,
      subagentOrchestrator: this.subagentOrchestrator,
      toolCallback: this.toolCallback,
      tunnelGateway: this.tunnelGateway,
      claudePtyRegistry: this.claudePtyRegistry,
      ptyInstanceRegistry: this.ptyInstanceRegistry,
      workflowRegistry: this.workflowRegistry,
      subagentTranscriptRegistry: this.subagentTranscriptRegistry,
      resolveClaudeDriverPreference: () => this.resolveClaudeDriverPreference(),
      isLoopArmed: (chatId) => this.isLoopArmed(chatId),
      closeClaudeSession: (chatId, session) => this.closeClaudeSession(chatId, session),
      enforceClaudeSessionBudget: (chatId) => this.enforceClaudeSessionBudget(chatId),
      readLlmProvider: () => this.readLlmProvider(),
      buildPoolUnavailableMessage: (reservedFor, scopeSuffix) =>
        this.buildPoolUnavailableMessage(reservedFor, scopeSuffix),
      listOpenRouterModelsFn: this.listOpenRouterModelsFn,
      getSubagents: () => this.getSubagents(),
      getAppSettingsSnapshot: () => this.getAppSettingsSnapshot(),
      getEnabledCustomMcpServers: () => this.getEnabledCustomMcpServers(),
      buildOAuthBearers: (servers) => this.buildOAuthBearers(servers),
      setupLoop: (chatId, input) => this.setupLoop({ chatId, input }),
      stopLoop: (chatId, reason) => this.stopLoop(chatId, reason),
      runOrchestration: (chatId, input) => this.runOrchestration(chatId, input),
      cancelOrchRun: (runId) => this.cancelOrchRun(runId),
      getOrchRunDetail: (runId) => this.getOrchRunDetail(runId),
      resolveChatPolicy: (chatId) => this.resolveChatPolicy(chatId),
      runClaudeSession: (session) => { void this.runClaudeSession(session) },
      mergeLocalCatalog: (commands, cwd) => this.mergeLocalCatalog(commands, cwd),
      emitStateChange: (chatId) => this.emitStateChange(chatId),
    }
  }

  /** @internal used by agent-deps-builders.ts via buildStartTurnDeps */
  startClaudeTurn(args: SpawnClaudeTurnArgs): Promise<HarnessTurn> {
    return spawnClaudeTurn(this.buildSpawnClaudeTurnDeps(), args)
  }

  /** Delegates to sendCommandFn — see claude-send-command.ts. */
  async send(command: Extract<ClientCommand, { type: "chat.send" }>) {
    return sendCommandFn(this.buildSendCommandDeps(), command)
  }

  /** @internal used by agent-deps-builders.ts via buildLoopOrchCommandDeps; Delegates to buildSubagentProviderRunForChatFn. */
  buildSubagentProviderRunForChat(args: BuildSubagentProviderRunForChatArgs): ProviderRunStart {
    return buildSubagentProviderRunForChatFn(this.buildSubagentWiringDeps(), args)
  }

  /**
   * StartWorker adapter for the OrchestrationQueue: spawn the run's configured
   * worker subagent against the task worktree (`spawn.cwd`) with the phase
   * prompt. Origin chat + subagent are read from the persisted run config so
   * this resolves identically on a fresh run and after a restart.
   */
  /** Delegates to buildOrchWorkerFn — see claude-loop-orch-commands.ts. */
  private async buildOrchWorker(spawn: WorkerSpawnArgs): Promise<WorkerResult> {
    return buildOrchWorkerFn(this.buildLoopOrchCommandDeps(), spawn)
  }

  /**
   * User-callable entry point (MCP `orch_run` + ws `orch.run`). Validates the
   * task list into the fixed linear config, then starts the run. Returns the
   * runId or the flat validation error list — never a partial run.
   * Delegates to runOrchestrationFn — see claude-loop-orch-commands.ts.
   */
  async runOrchestration(
    chatId: string,
    input: OrchRunInput,
  ): Promise<{ ok: true; runId: string } | { ok: false; errors: string[] }> {
    return runOrchestrationFn(this.buildLoopOrchCommandDeps(), chatId, input)
  }

  /** Cancel a run (MCP `orch_cancel_run` + ws `orch.cancelRun`). Delegates to cancelOrchRunFn. */
  async cancelOrchRun(runId: string): Promise<void> {
    return cancelOrchRunFn(this.buildLoopOrchCommandDeps(), runId)
  }

  /** Canonical run detail DTO (MCP `orch_run_status` + ws `orch.getRun`). Delegates to getOrchRunDetailFn. */
  getOrchRunDetail(runId: string): OrchRunDetail | null {
    return getOrchRunDetailFn(this.buildLoopOrchCommandDeps(), runId)
  }

  async enqueue(command: Extract<ClientCommand, { type: "message.enqueue" }>) {
    if (typeof command.autoResumeOnRateLimit === "boolean") {
      this.autoResumeByChat.set(command.chatId, command.autoResumeOnRateLimit)
    }
    this.analytics.track("message_sent")
    const queuedMessage = await this.enqueueMessage(command.chatId, command.content, command.attachments ?? [], {
      provider: command.provider,
      model: command.model,
      modelOptions: command.modelOptions,
      planMode: command.planMode,
    })
    return { queuedMessageId: queuedMessage.id }
  }

  async steer(command: Extract<ClientCommand, { type: "message.steer" }>) {
    return steerFn(this.buildChatManagementDeps(), command)
  }

  async dequeue(command: Extract<ClientCommand, { type: "message.dequeue" }>) {
    return dequeueFn(this.buildChatManagementDeps(), command)
  }

  async forkChat(chatId: string) {
    return forkChatFn(this.buildChatManagementDeps(), chatId)
  }

  private buildRunClaudeSessionDeps(): RunClaudeSessionDeps {
    return {
      openrouterFirstEntryTimeoutMs: this.openrouterFirstEntryTimeoutMs,
      claudeSessions: this.claudeSessions,
      activeTurns: this.activeTurns,
      oauthPool: this.oauthPool,
      claudeLimitDetector: this.claudeLimitDetector,
      claudeAuthErrorDetector: this.claudeAuthErrorDetector,
      throwOnClaudeSessionStart: this.throwOnClaudeSessionStart,
      store: this.store,
      emitStateChange: (chatId) => this.emitStateChange(chatId),
      handleLimitDetection: (chatId, detection) => this.handleLimitDetection(chatId, detection),
      maybeRegisterSdkWorkflowsDir: (s) => this.maybeRegisterSdkWorkflowsDir(s),
      getSubagents: () => this.getSubagents(),
      resolveBackgroundTaskMaxMs: () => this.resolveBackgroundTaskMaxMs(),
      mergeLocalCatalog: (commands, cwd) => this.mergeLocalCatalog(commands, cwd),
      handleLimitError: (chatId, detector, error) => this.handleLimitError(chatId, detector, error),
      handleAuthFailure: (s, detection) => this.handleAuthFailure(s, detection),
      closeClaudeSession: (chatId, s) => this.closeClaudeSession(chatId, s),
      maybeStartNextQueuedMessage: (chatId) => this.maybeStartNextQueuedMessage(chatId),
      resolveClaudeDriverPreference: () => this.resolveClaudeDriverPreference(),
    }
  }

  /** @internal used by agent-deps-builders.ts via buildSpawnClaudeTurnDeps */
  async runClaudeSession(session: ClaudeSessionState) {
    return runClaudeSessionLoop(this.buildRunClaudeSessionDeps(), session)
  }

  /** @internal used by agent-deps-builders.ts via buildChatManagementDeps */
  async generateTitleInBackground(chatId: string, messageContent: string, cwd: string, expectedCurrentTitle: string) {
    return generateTitleInBackgroundFn(this.buildChatManagementDeps(), chatId, messageContent, cwd, expectedCurrentTitle)
  }

  private buildRunTurnDeps(): RunTurnDeps {
    return {
      store: this.store,
      activeTurns: this.activeTurns,
      drainingStreams: this.drainingStreams,
      oauthPool: this.oauthPool,
      codexLimitDetector: this.codexLimitDetector,
      handleLimitError: (chatId, detector, error) => this.handleLimitError(chatId, detector, error),
      emitStateChange: (chatId) => { this.emitStateChange(chatId) },
      clearDrainingStream: (chatId) => { this.clearDrainingStream(chatId) },
      startTurnForChat: (args) => this.startTurnForChat(args),
      maybeStartNextQueuedMessage: (chatId) => this.maybeStartNextQueuedMessage(chatId),
    }
  }

  /** @internal used by agent-deps-builders.ts via buildStartTurnDeps; Delegates to runTurnFn. */
  async runTurn(active: ActiveTurn): Promise<void> {
    return runTurnFn(this.buildRunTurnDeps(), active)
  }

  /** @internal used by agent-deps-builders.ts via buildSessionErrorHandlerDeps; Delegates to resolveAutoResumeForFn. */
  resolveAutoResumeFor(chatId: string): boolean {
    return resolveAutoResumeForFn(this.buildAutoContinueCommandDeps(), chatId)
  }

  /** @internal used by agent-deps-builders.ts via buildSessionErrorHandlerDeps + buildLoopOrchCommandDeps; Delegates to emitAutoContinueEventFn. */
  async emitAutoContinueEvent(event: AutoContinueEvent): Promise<void> {
    return emitAutoContinueEventFn(this.buildAutoContinueCommandDeps(), event)
  }

  /** @internal used by agent-deps-builders.ts via buildRunClaudeSessionDeps + buildRunTurnDeps; Delegates to handleLimitErrorFn. */
  async handleLimitError(chatId: string, detector: LimitDetector, error: AnyValue): Promise<boolean> {
    return handleLimitErrorFn(this.buildSessionErrorHandlerDeps(), chatId, detector, error)
  }

  /** @internal used by agent-deps-builders.ts via buildRunClaudeSessionDeps; Delegates to handleLimitDetectionFn. */
  async handleLimitDetection(chatId: string, detection: LimitDetection): Promise<boolean> {
    return handleLimitDetectionFn(this.buildSessionErrorHandlerDeps(), chatId, detection)
  }

  /** @internal used by agent-deps-builders.ts via buildRunClaudeSessionDeps; Delegates to handleAuthFailureFn. */
  async handleAuthFailure(
    session: ClaudeSessionState,
    detection: AuthErrorDetection,
  ): Promise<boolean> {
    return handleAuthFailureFn(this.buildSessionErrorHandlerDeps(), session, detection)
  }

  /** Delegates to fireAutoContinueFn — see claude-autocontinue-commands.ts. */
  async fireAutoContinue(chatId: string, scheduleId: string) {
    return fireAutoContinueFn(this.buildAutoContinueCommandDeps(), chatId, scheduleId)
  }

  /** Delegates to acceptAutoContinueFn — see claude-autocontinue-commands.ts. */
  async acceptAutoContinue(chatId: string, scheduleId: string, scheduledAt: number): Promise<void> {
    return acceptAutoContinueFn(this.buildAutoContinueCommandDeps(), chatId, scheduleId, scheduledAt)
  }

  /** Delegates to rescheduleAutoContinueFn — see claude-autocontinue-commands.ts. */
  async rescheduleAutoContinue(chatId: string, scheduleId: string, scheduledAt: number): Promise<void> {
    return rescheduleAutoContinueFn(this.buildAutoContinueCommandDeps(), chatId, scheduleId, scheduledAt)
  }

  /** Delegates to cancelAutoContinueFn — see claude-autocontinue-commands.ts. */
  async cancelAutoContinue(chatId: string, scheduleId: string, reason: "user" | "chat_deleted"): Promise<void> {
    return cancelAutoContinueFn(this.buildAutoContinueCommandDeps(), chatId, scheduleId, reason)
  }

  /**
   * Deliver a finished `run_in_background` subagent's result back into the
   * main chat as a fresh turn AND clear the main-agent's Claude session so the
   * next turn starts with a fresh context window. Wired as the orchestrator's
   * `onBackgroundRunComplete` hook. Delegates to deliverSubagentToMainFn —
   * see claude-loop-orch-commands.ts.
   */
  private async deliverSubagentToMain(
    chatId: string,
    runId: string,
    outcome: BackgroundRunOutcome,
  ): Promise<void> {
    return deliverSubagentToMainFn(this.buildLoopOrchCommandDeps(), chatId, runId, outcome)
  }

  /**
   * Arm an autonomous loop on the main chat. Validates the loop spec, ensures
   * the tracking file exists (writes a skeleton if absent), then /clears the
   * main-agent Claude session and enqueues the templated recurring prompt so
   * the next turn starts the loop. Backs `mcp__kanna__setup_loop`. Delegates
   * to setupLoopFn — see claude-loop-orch-commands.ts.
   */
  async setupLoop(args: {
    chatId: string
    input: LoopSetupInput
  }): Promise<SetupLoopHandlerResult> {
    return setupLoopFn(this.buildLoopOrchCommandDeps(), args)
  }

  /** Current armed-loop state for a chat, or null. Delegates to isLoopArmedFn — see claude-loop-orch-commands.ts. */
  isLoopArmed(chatId: string): LoopState | null {
    return isLoopArmedFn(this.buildLoopOrchCommandDeps(), chatId)
  }

  /**
   * Disarm an armed loop (restores tools + stops prompt re-injection). Backs
   * the `stop_loop` MCP tool (called by the model on GOAL MET) and the
   * user-send takeover path. No-op when no loop is armed. Delegates to
   * stopLoopFn — see claude-loop-orch-commands.ts.
   */
  async stopLoop(chatId: string, reason: "goal_met" | "user_send" | "chat_deleted"): Promise<void> {
    return stopLoopFn(this.buildLoopOrchCommandDeps(), chatId, reason)
  }

  /** Delegates to listLiveSchedulesFn — see claude-loop-orch-commands.ts. */
  listLiveSchedules(chatId: string): string[] {
    return listLiveSchedulesFn(this.buildLoopOrchCommandDeps(), chatId)
  }

  async killPtyInstance(chatId: string): Promise<void> {
    return killPtyInstanceFn(this.buildClaudeSessionConfigHelpersDeps(), chatId)
  }

  async cancel(chatId: string, options?: { hideInterrupted?: boolean; skipQueueDrain?: boolean }) {
    return cancelChatFn(this.buildCancelHandlerDeps(), chatId, options)
  }

  async respondTool(command: Extract<ClientCommand, { type: "chat.respondTool" }>) {
    return respondToolFn(this.buildToolRespondDeps(), command)
  }

  async respondSubagentTool(command: Extract<ClientCommand, { type: "chat.respondSubagentTool" }>) {
    return respondSubagentToolFn(this.buildSubagentToolResponseDeps(), command)
  }

  async cancelSubagentRun(
    command: Extract<ClientCommand, { type: "chat.cancelSubagentRun" }>,
  ) {
    cancelSubagentRunFn(this.buildSubagentToolResponseDeps(), command)
  }
}
