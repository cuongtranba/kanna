import { type KannaMcpDelegationContext, type SetupLoopHandlerResult } from "./kanna-mcp"
import type { LoopSetupInput } from "./loop-template"
import { reconcileTrackingFile, validateLoopSetup } from "./loop-template"
import { ensureTrackingFile } from "./loop-template-io.adapter"
import { homedir } from "node:os"
import type {
  AgentProvider,
  ChatAttachment,
  LlmProviderSnapshot,
  McpOAuthState,
  McpServerConfig,
  PendingToolSnapshot,
  KannaStatus,
  QueuedChatMessage,
  SlashCommand,
  Subagent,
} from "../shared/types"
import {
  getLatestContextWindowUsage,
  MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
  shouldProactivelyCompact,
} from "./proactive-compact"
import type { ClientCommand } from "../shared/protocol"
import { LOG_PREFIX } from "../shared/branding"
import { buildKannaSystemPromptAppend } from "../shared/kanna-system-prompt"
import { EventStore } from "./event-store"
import type { AnalyticsReporter } from "./analytics"
import { NoopAnalyticsReporter } from "./analytics"
import { CodexAppServerManager } from "./codex-app-server"
import { resolveSubagentRoots } from "./paths"
import { realpathAdapter } from "./paths-fs.adapter"
import { type GenerateChatTitleResult, generateTitleForChatDetailed } from "./generate-title"
import type { ClaudeSessionHandle, HarnessToolRequest, HarnessTurn } from "./harness-types"
import { startClaudeSession } from "./claude-session-start"
import {
  codexServiceTierFromModelOptions,
  getServerProviderCatalog,
  isClaudeSdkProvider,
  normalizeClaudeModelOptions,
  normalizeCodexModelOptions,
  normalizeServerModel,
  openrouterAuthReady,
} from "./provider-catalog"
import { readLlmProviderSnapshot } from "./llm-provider"
import type { ModelPrice } from "../shared/token-pricing"
import { providerUsesSdkSession, resolveClaudeApiModelId, type ClaudeDriverPreference, type CustomModelEntry } from "../shared/types"
import { AUTO_CONTINUE_EVENT_VERSION, type AutoContinueEvent } from "./auto-continue/events"
import { ClaudeLimitDetector, CodexLimitDetector, type LimitDetection, type LimitDetector } from "./auto-continue/limit-detector"
import { ClaudeAuthErrorDetector, type AuthErrorDetection } from "./auto-continue/auth-error-detector"
import type { ScheduleManager } from "./auto-continue/schedule-manager"
import { deriveChatSchedules, deriveLoopState, type LoopState } from "./auto-continue/read-model"
import type { TunnelGateway } from "./cloudflare-tunnel/gateway"
import { OAuthTokenPool } from "./oauth-pool/oauth-token-pool"
import { maskOauthKey } from "../shared/mask-oauth-key"
import { SubagentOrchestrator, type BackgroundRunOutcome, type ProviderRunStart } from "./subagent-orchestrator"
import { buildSubagentProviderRun, type BuildSubagentProviderRunArgs } from "./subagent-provider-run"
import { OrchestrationQueue, type WorkerResult, type WorkerSpawnArgs } from "./orchestration-queue"
import { createOrchWorktreeOps } from "./orchestration-worktree.adapter"
import { runCommandInWorktree } from "./orchestration-exec-io.adapter"
import { toOrchRunDetail, validateOrchRun, type OrchRunContext } from "./orchestration-input"
import type { OrchRunDetail, OrchRunInput } from "../shared/orchestration-types"
import type { ToolCallbackService } from "./tool-callback"
import type { ChatPermissionPolicy } from "../shared/permission-policy"
import { mergePolicyOverride, POLICY_DEFAULT } from "../shared/permission-policy"
import {
  LOOP_BLOCKED_NATIVE_TOOLS,
  buildCanUseTool,
  buildClaudeEnv,
  type BuildCanUseToolArgs,
} from "./claude-spawn-helpers"
export { LOOP_BLOCKED_NATIVE_TOOLS, buildCanUseTool, buildClaudeEnv, type BuildCanUseToolArgs }
import { startClaudeSessionPTY, type StartClaudeSessionPtyArgs } from "./claude-pty/driver"
import { computeWorkflowsDir } from "./claude-pty/jsonl-path.adapter"
import { ensureFreshMcpToken } from "./mcp-oauth.adapter"
import { log } from "../shared/log"
import { type AnyValue, isRecord } from "../shared/errors"
import {
  timestamped,
  type ClaudeRawSdkMessage,
  getClaudeAssistantMessageUsageId,
  normalizeClaudeStreamMessage,
  normalizeToolContent,
} from "./claude-message-normalizer"
import { discardedToolResult } from "./claude-sdk-queue"
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
  buildSteeredMessageContent,
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
  logClaudeSteer,
  logSendToStartingProfile,
  type SendMessageOptions,
  type SendToStartingProfile,
} from "./claude-steer-log"
import type { ActiveTurn, ClaudeSessionState } from "./claude-session-state"
import { runClaudeSession as runClaudeSessionLoop } from "./claude-session-runner"
import {
  startTurnForChat as startTurnForChatFn,
  type StartTurnDeps,
} from "./claude-turn-starter"
import { spawnClaudeTurn, type SpawnClaudeTurnArgs } from "./claude-session-spawner"

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


const TOKEN_ROTATION_SCHEDULE_DELAY_MS = 100
// When a single OAuth token is shared by N chats (per
// adr-20260522-oauth-token-share-cap), all N chats can detect the same
// rate-limit / auth-error simultaneously. Each respawn (esp. under PTY) is
// expensive; offset them by this many ms per additional victim so the cold-
// boot herd spreads across roughly a second instead of stampeding.
const TOKEN_ROTATION_HERD_STAGGER_MS = 250
// Dedupe window for repeat rotation events on the same tokenId. Within this
// window, secondary detectors only increment the stagger counter; they do
// not double-mark the pool or double-pick a fresh target via pickActive().
const TOKEN_ROTATION_DEDUPE_WINDOW_MS = 5_000
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
  private readonly tokenRotationDedupe = new Map<string, { firstSeenAt: number; staggerCount: number }>()
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
    const statuses = new Map<string, KannaStatus>()
    for (const [chatId, turn] of this.activeTurns.entries()) {
      statuses.set(chatId, turn.status)
    }
    return statuses
  }

  getWaitStartedAtByChatId(): Map<string, number> {
    const out = new Map<string, number>()
    for (const [chatId, turn] of this.activeTurns.entries()) {
      if (turn.waitStartedAt != null) out.set(chatId, turn.waitStartedAt)
    }
    return out
  }

  getPendingTool(chatId: string): PendingToolSnapshot | null {
    const pending = this.activeTurns.get(chatId)?.pendingTool
    if (!pending) return null
    return { toolUseId: pending.toolUseId, toolKind: pending.tool.toolKind }
  }

  getDrainingChatIds(): Set<string> {
    return new Set(this.drainingStreams.keys())
  }

  getSlashCommandsLoadingChatIds(): Set<string> {
    return new Set(this.slashCommandsInFlight)
  }

  /**
   * Snapshot of live claude PTY session states per chat. Used by the
   * sidebar badge selector. Chats not present are implicitly `cold`.
   */
  getClaudeSessionStates(): Map<string, "warming" | "active" | "idle"> {
    const out = new Map<string, "warming" | "active" | "idle">()
    const now = Date.now()
    for (const [chatId, session] of this.claudeSessions) {
      const activeProv = this.activeTurns.get(chatId)?.provider
      if (activeProv !== undefined && isClaudeSdkProvider(activeProv)) {
        out.set(chatId, "active")
      } else if (this.hasPendingBackgroundTask(session, now)) {
        // Held warm for a background Bash task — surface as "warming", not "idle".
        out.set(chatId, "warming")
      } else if (now - session.lastUsedAt >= this.resolveClaudeIdleMs()) {
        out.set(chatId, "idle")
      } else {
        out.set(chatId, "warming")
      }
    }
    return out
  }

  get toolCallbackService(): ToolCallbackService | null {
    return this.toolCallback
  }

  private emitStateChange(chatId?: string, options?: { immediate?: boolean }) {
    this.onStateChange(chatId, options)
  }

  private resolveClaudeDriverPreference(): ClaudeDriverPreference {
    const fromSettings = this.getAppSettingsSnapshot().claudeDriver?.preference
    if (fromSettings === "pty" || fromSettings === "sdk") return fromSettings
    return process.env.KANNA_CLAUDE_DRIVER === "pty" ? "pty" : "sdk"
  }

  private getEnabledCustomMcpServers(): readonly McpServerConfig[] {
    const snap = this.getAppSettingsSnapshot()
    const list = snap.customMcpServers
    if (!Array.isArray(list)) return []
    return list.filter((s) => s.enabled)
  }

  private async buildOAuthBearers(servers: readonly McpServerConfig[]): Promise<Map<string, string>> {
    const bearers = new Map<string, string>()
    for (const s of servers) {
      if (s.transport === "stdio" || !s.oauth || s.oauth.status !== "authenticated") continue
      try {
        const token = await ensureFreshMcpToken(s, {
          persist: (oauth) => {
            if (this.persistOAuthStateFn) this.persistOAuthStateFn(s.id, oauth)
          },
        })
        bearers.set(s.id, token)
      } catch (err) {
        log.warn("[kanna/mcp-oauth] token refresh failed for", s.name, String(err))
      }
    }
    return bearers
  }

  /**
   * Resolves the effective ChatPermissionPolicy for a chat: starts from the
   * coordinator-wide default, overlays the chat's persisted policyOverride.
   */
  private resolveChatPolicy(chatId: string): ChatPermissionPolicy {
    // store.state may be absent in test fakes that don't implement the full
    // EventStore — fall through to the global default policy in that case.
    const override = this.store.state?.chatsById?.get(chatId)?.policyOverride ?? null
    return mergePolicyOverride(this.chatPolicy, override)
  }

  private resolveClaudeIdleMs(): number {
    const fromSettings = this.getAppSettingsSnapshot().claudeDriver?.lifecycle?.idleTimeoutMs
    if (typeof fromSettings === "number" && Number.isFinite(fromSettings) && fromSettings > 0) {
      return Math.round(fromSettings)
    }
    return this.claudeSessionLifecycle.idleMs
  }

  private resolveClaudeMaxResident(): number {
    const fromSettings = this.getAppSettingsSnapshot().claudeDriver?.lifecycle?.maxConcurrent
    if (typeof fromSettings === "number" && Number.isFinite(fromSettings) && fromSettings > 0) {
      return Math.round(fromSettings)
    }
    return this.claudeSessionLifecycle.maxResidentSessions
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
    return this.workflowRegistry?.hasActiveRun(chatId, this.resolveClaudeIdleMs(), Date.now()) ?? false
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
    if (session.backgroundTaskIds.size === 0) return false
    if (now < session.backgroundTaskDeadlineAt) return true
    session.backgroundTaskIds.clear()
    session.backgroundTaskDeadlineAt = 0
    return false
  }

  private isClaudeSessionIdle(chatId: string, session: ClaudeSessionState, now = Date.now()): boolean {
    const activeProv = this.activeTurns.get(chatId)?.provider
    if (activeProv !== undefined && isClaudeSdkProvider(activeProv)) return false
    if (session.pendingPromptSeqs.length > 0) return false
    if (this.hasLiveWorkflow(chatId)) return false
    if (this.hasPendingBackgroundTask(session, now)) return false
    return now - session.lastUsedAt >= this.resolveClaudeIdleMs()
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
    if (this.claudeSessions.get(chatId) === session) {
      this.claudeSessions.delete(chatId)
    }
    if (!opts?.keepReservation) {
      this.oauthPool?.release(chatId)
    }
    session.session.close()
    // For SDK sessions, unregister the workflow dir here. PTY sessions unregister
    // inside the driver's cleanupResources (driver.ts) — do not double-fire.
    if (this.resolveClaudeDriverPreference() !== "pty") {
      this.workflowRegistry?.unregister(chatId)
    }
  }

  /**
   * Register the workflow disk-watch dir for an SDK session once the session
   * token is known. No-op if the registry is absent, already registered, or
   * the driver preference is PTY (the PTY driver registers from its own
   * resolved transcript path in driver.ts cleanup and must not be double-fired).
   */
  private maybeRegisterSdkWorkflowsDir(session: ClaudeSessionState): void {
    if (!this.workflowRegistry) return
    if (session.workflowsDirRegistered) return
    // PTY registers from its own resolved transcript path; SDK derives from session_token.
    if (this.resolveClaudeDriverPreference() === "pty") return
    if (!session.sessionToken) return
    const dir = computeWorkflowsDir({
      homeDir: homedir(),
      cwd: session.localPath,
      sessionId: session.sessionToken,
    })
    this.workflowRegistry.register(session.chatId, dir)
    session.workflowsDirRegistered = true
  }

  private sweepIdleClaudeSessions(now = Date.now()): void {
    for (const [chatId, session] of [...this.claudeSessions.entries()]) {
      if (!this.isClaudeSessionIdle(chatId, session, now)) continue
      this.closeClaudeSession(chatId, session)
      this.emitStateChange(chatId)
    }
  }

  private enforceClaudeSessionBudget(protectedChatId?: string): void {
    const max = this.resolveClaudeMaxResident()
    if (max <= 0 || this.claudeSessions.size <= max) return

    const now = Date.now()
    const candidates = [...this.claudeSessions.entries()]
      .filter(([chatId, session]) => (
        chatId !== protectedChatId
        && !this.activeTurns.has(chatId)
        && session.pendingPromptSeqs.length === 0
        && !this.hasLiveWorkflow(chatId)
        && !this.hasPendingBackgroundTask(session, now)
      ))
      .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)

    while (this.claudeSessions.size > max && candidates.length > 0) {
      const next = candidates.shift()
      if (!next) break
      const [chatId, session] = next
      this.closeClaudeSession(chatId, session)
      this.emitStateChange(chatId)
    }
  }

  /**
   * Format a refusal message when `pickActive(chatId)` returned null but the
   * pool has tokens. Names the offending tokens so the user knows which
   * chat to close or which token to add a quota to, instead of seeing the
   * generic "all tokens unavailable" line that doesn't say what's holding
   * them. `scopeSuffix` lets the subagent path tag its variant.
   */
  private buildPoolUnavailableMessage(reservedFor: string, scopeSuffix: string): string {
    const pool = this.oauthPool
    if (!pool) {
      return `All OAuth tokens are unavailable${scopeSuffix} (rate-limited, errored, or in use).`
    }
    const now = Date.now()
    const fmtTime = (ms: number) => {
      const mins = Math.max(0, Math.round((ms - now) / 60_000))
      if (mins < 60) return `${mins}m`
      const h = Math.floor(mins / 60)
      const m = mins % 60
      return m === 0 ? `${h}h` : `${h}h${m}m`
    }
    const lines: string[] = []
    for (const u of pool.describeUnavailability(reservedFor)) {
      if (u.reason === "available") continue
      const label = u.label || u.tokenId.slice(0, 8)
      if (u.reason === "limited") {
        lines.push(`  - ${label}: rate-limited (~${fmtTime(u.until)} remaining)`)
      } else if (u.reason === "reserved") {
        const refs = u.byChatIds.map((id) => {
          const chat = this.store.getChat(id)
          const title = chat?.title || `chat ${id.slice(0, 8)}`
          return `[${title}](/chat/${id})`
        })
        const joined = refs.length === 0 ? "another chat" : refs.join(", ")
        lines.push(`  - ${label}: in use by ${joined}`)
      } else if (u.reason === "error") {
        lines.push(`  - ${label}: errored${u.message ? ` (${u.message})` : ""}`)
      } else if (u.reason === "disabled") {
        lines.push(`  - ${label}: disabled`)
      }
    }
    const header = `All OAuth tokens are unavailable${scopeSuffix}:`
    const footer = "Close the chat holding a contested token, wait for the rate-limit to reset, or add another token."
    return [header, ...lines, footer].join("\n")
  }

  private subagentPendingKey(chatId: string, runId: string, toolUseId: string): string {
    return `${chatId}::${runId}::${toolUseId}`
  }

  private rejectPendingResolvers(predicate: (key: string) => boolean, reason: string) {
    for (const [key, resolver] of this.subagentPendingResolvers) {
      if (!predicate(key)) continue
      this.subagentPendingResolvers.delete(key)
      resolver.reject(new Error(reason))
    }
  }

  private rejectPendingResolversForChat(chatId: string) {
    const prefix = `${chatId}::`
    this.rejectPendingResolvers((k) => k.startsWith(prefix), "chat cancelled")
  }

  private rejectPendingResolversForRun(chatId: string, runId: string) {
    const prefix = `${chatId}::${runId}::`
    this.rejectPendingResolvers((k) => k.startsWith(prefix), "subagent run terminated")
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
    const draining = this.drainingStreams.get(chatId)
    if (!draining) return
    draining.turn.close()
    this.clearDrainingStream(chatId)
    this.emitStateChange(chatId)
  }

  async ensureSlashCommandsLoaded(chatId: string): Promise<void> {
    const chat = this.store.getChat(chatId)
    if (!chat) return
    if (chat.provider === "codex") return
    if (chat.slashCommands && chat.slashCommands.length > 0) return
    if (this.slashCommandsInFlight.has(chatId)) return

    const project = this.store.getProject(chat.projectId)
    if (!project) return

    this.slashCommandsInFlight.add(chatId)
    this.emitStateChange(chatId)
    try {
      let commands: SlashCommand[]
      const existing = this.claudeSessions.get(chatId)
      if (existing) {
        commands = await existing.session.getSupportedCommands()
      } else {
        const defaultModel = normalizeServerModel("claude")
        const defaultOptions = normalizeClaudeModelOptions(defaultModel)
        // Ephemeral spawn: reserve under a synthetic key so two concurrent
        // ensureSlashCommandsLoaded calls (different chats) cannot be handed
        // the same token by lastUsedAt ordering. The lease MUST be released
        // once the throwaway session closes (audit #2).
        const lease = this.oauthPool?.pickEphemeral() ?? null
        // Skip the ephemeral spawn entirely when the pool has tokens but
        // nothing is usable — avoids 401 against the CLI's keychain fallback
        // and an opaque "supportedCommands failed" warning. Slash commands
        // will load on the next turn once a token is available.
        if (this.oauthPool && this.oauthPool.hasAnyToken() && !lease) {
          return
        }
        const picked = lease?.token ?? null
        if (picked) this.oauthPool!.markUsed(picked.id)
        const usePtyEphemeral = this.resolveClaudeDriverPreference() === "pty"
        const ephemeralSystemPromptAppend = buildKannaSystemPromptAppend(this.getSubagents(), {
          globalPromptAppend: this.getAppSettingsSnapshot().globalPromptAppend,
        })
        try {
          const ephemeral = usePtyEphemeral
            ? await this.startClaudeSessionPTYFn({
                chatId,
                projectId: project.id,
                localPath: project.localPath,
                model: resolveClaudeApiModelId(defaultModel, defaultOptions.contextWindow),
                effort: defaultOptions.reasoningEffort,
                planMode: chat.planMode ?? false,
                sessionToken: chat.sessionTokensByProvider.claude ?? null,
                forkSession: false,
                oauthToken: picked?.token ?? null,
                oauthLabel: picked?.label,
                oauthKeyMasked: picked ? maskOauthKey(picked.token) : undefined,
                onToolRequest: async () => null,
                systemPromptAppend: ephemeralSystemPromptAppend,
                ptyRegistry: this.claudePtyRegistry ?? undefined,
                ptyInstanceRegistry: this.ptyInstanceRegistry ?? undefined,
                workflowRegistry: this.workflowRegistry ?? undefined,
                subagentTranscriptRegistry: this.subagentTranscriptRegistry ?? undefined,
                customMcpServers: this.getEnabledCustomMcpServers(),
                  })
            : await this.startClaudeSessionFn({
                projectId: project.id,
                localPath: project.localPath,
                model: resolveClaudeApiModelId(defaultModel, defaultOptions.contextWindow),
                effort: defaultOptions.reasoningEffort,
                planMode: chat.planMode ?? false,
                sessionToken: chat.sessionTokensByProvider.claude ?? null,
                forkSession: false,
                oauthToken: picked?.token ?? null,
                onToolRequest: async () => null,
                systemPromptAppend: ephemeralSystemPromptAppend,
                customMcpServers: this.getEnabledCustomMcpServers(),
              })
          try {
            commands = await ephemeral.getSupportedCommands()
          } finally {
            ephemeral.close()
          }
        } finally {
          lease?.release()
        }
      }
      const merged = this.mergeLocalCatalog(commands, project.localPath)
      await this.store.recordSessionCommandsLoaded(chatId, merged)
      this.emitStateChange(chatId)
    } catch (error) {
      log.warn("[kanna/agent] ensureSlashCommandsLoaded failed", String(error))
    } finally {
      this.slashCommandsInFlight.delete(chatId)
      this.emitStateChange(chatId)
    }
  }

  private mergeLocalCatalog(commands: SlashCommand[], cwd: string): SlashCommand[] {
    if (!this.localCatalog) return commands
    let local: SlashCommand[]
    try {
      local = this.localCatalog.list(cwd)
    } catch (error) {
      log.warn("[kanna/agent] localCatalog.list failed", String(error))
      return commands
    }
    const cliKeys = new Set(commands.map((c) => c.name.toLowerCase()))
    const filtered = local.filter((entry) => !cliKeys.has(entry.name.toLowerCase()))
    return [...commands, ...filtered]
  }

  async closeChat(chatId: string) {
    await this.stopDraining(chatId)
    const claudeSession = this.claudeSessions.get(chatId)
    if (claudeSession) {
      this.closeClaudeSession(chatId, claudeSession)
    }
    this.autoResumeByChat.delete(chatId)
    this.emitStateChange(chatId)
  }

  private resolveProvider(options: SendMessageOptions, currentProvider: AgentProvider | null) {
    return options.provider ?? currentProvider ?? "claude"
  }

  private getProviderSettings(provider: AgentProvider, options: SendMessageOptions) {
    const catalog = getServerProviderCatalog(provider)
    const customModels = this.getAppSettingsSnapshot().customModels ?? []
    if (provider === "claude") {
      const model = normalizeServerModel(provider, options.model, customModels)
      const modelOptions = normalizeClaudeModelOptions(model, options.modelOptions, options.effort, customModels)
      return {
        model: resolveClaudeApiModelId(model, modelOptions.contextWindow),
        effort: modelOptions.reasoningEffort,
        serviceTier: undefined,
        planMode: catalog.supportsPlanMode ? Boolean(options.planMode) : false,
      }
    }

    if (provider === "openrouter") {
      // OpenRouter's model list is fetched dynamically (settings.listOpenRouterModels),
      // so the static server catalog is empty and normalizeServerModel would collapse
      // every selection to the default. Trust the client-selected id — OpenRouter
      // rejects invalid ids at the API — falling back to the default only when blank.
      return {
        model: options.model?.trim() || catalog.defaultModel,
        effort: undefined,
        serviceTier: undefined,
        planMode: catalog.supportsPlanMode ? Boolean(options.planMode) : false,
      }
    }

    const modelOptions = normalizeCodexModelOptions(options.modelOptions, options.effort)
    return {
      model: normalizeServerModel(provider, options.model, customModels),
      effort: modelOptions.reasoningEffort,
      serviceTier: codexServiceTierFromModelOptions(modelOptions),
      planMode: catalog.supportsPlanMode ? Boolean(options.planMode) : false,
    }
  }

  private async enqueueMessage(chatId: string, content: string, attachments: ChatAttachment[], options?: SendMessageOptions) {
    const queued = await this.store.enqueueMessage(chatId, {
      content,
      attachments,
      provider: options?.provider,
      model: options?.model,
      modelOptions: options?.modelOptions,
      planMode: options?.planMode,
      autoContinue: options?.autoContinue,
    })
    this.emitStateChange(chatId)
    return queued
  }

  private async dequeueAndStartQueuedMessage(chatId: string, queuedMessage: QueuedChatMessage, options?: { steered?: boolean }) {
    await this.store.removeQueuedMessage(chatId, queuedMessage.id)
    const chat = this.store.requireChat(chatId)

    // Mentions no longer short-circuit the main turn (Anthropic-style
    // Task-tool pattern). The main agent always runs; mention metadata is
    // still attached to the user_prompt entry by `startTurnForChat` →
    // `appendUserPrompt`.
    const provider = this.resolveProvider(queuedMessage, chat.provider)
    const settings = this.getProviderSettings(provider, queuedMessage)
    // Auto-continue rate-limit recovery sends the literal "continue" as a
    // resume signal. Appending it as a user_prompt entry adds noise to the
    // transcript (shows as an "auto-sent" bubble right before a COMPACTED
    // divider, confusing the user). Suppress the entry for that fallback
    // case; agent-driven wakes with a meaningful custom prompt still appear.
    const isRateLimitFallback = queuedMessage.autoContinue !== undefined
      && queuedMessage.content === "continue"
    await this.startTurnForChat({
      chatId,
      provider,
      content: options?.steered ? buildSteeredMessageContent(queuedMessage.content) : queuedMessage.content,
      attachments: queuedMessage.attachments,
      model: settings.model,
      effort: settings.effort,
      serviceTier: settings.serviceTier,
      planMode: settings.planMode,
      appendUserPrompt: !isRateLimitFallback,
      steered: options?.steered,
      autoContinue: queuedMessage.autoContinue,
    })
  }

  private async maybeStartNextQueuedMessage(chatId: string) {
    if (this.activeTurns.has(chatId)) return false
    const nextQueuedMessage = typeof this.store.getQueuedMessages === "function"
      ? this.store.getQueuedMessages(chatId)[0]
      : undefined
    if (!nextQueuedMessage) return false
    await this.dequeueAndStartQueuedMessage(chatId, nextQueuedMessage)
    return true
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


  private recreateActiveTurnFromSession(args: {
    chatId: string
    provider: AgentProvider
    model: string
    effort?: string
    serviceTier?: "fast"
    planMode: boolean
    clientTraceId?: string
  }): ActiveTurn | undefined {
    if (!providerUsesSdkSession(args.provider)) return undefined
    const session = this.claudeSessions.get(args.chatId)
    if (!session) return undefined

    const ghostTurn: HarnessTurn = {
      provider: args.provider,
      stream: { async *[Symbol.asyncIterator]() {} },
      getAccountInfo: session.session.getAccountInfo,
      interrupt: session.session.interrupt,
      close: () => {},
    }

    const active: ActiveTurn = {
      chatId: args.chatId,
      provider: args.provider,
      turn: ghostTurn,
      model: session.model,
      effort: session.effort,
      serviceTier: args.serviceTier,
      planMode: session.planMode,
      status: "waiting_for_user",
      pendingTool: null,
      postToolFollowUp: null,
      hasFinalResult: false,
      cancelRequested: false,
      cancelRecorded: false,
      clientTraceId: args.clientTraceId,
      waitStartedAt: null,
      userMessageId: this.findLastUserMessageId(args.chatId),
    }
    this.activeTurns.set(args.chatId, active)
    return active
  }

  private findLastUserMessageId(chatId: string): string | null {
    const messages = this.store.getMessages(chatId)
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const entry = messages[i]
      if (entry.kind === "user_prompt") return entry._id
    }
    return null
  }

  private startClaudeTurn(args: SpawnClaudeTurnArgs): Promise<HarnessTurn> {
    return spawnClaudeTurn(
      {
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
      },
      args,
    )
  }

  async send(command: Extract<ClientCommand, { type: "chat.send" }>) {
    const profile = command.clientTraceId
      ? { traceId: command.clientTraceId, startedAt: performance.now() }
      : null
    let chatId = command.chatId

    // A real user chat.send means the agent is active again — release any
    // background-task keep-alive guard so the session reaps normally afterward.
    // Auto-continue / agent wakes bypass `send` and intentionally do NOT clear it.
    const existingClaudeSession = chatId ? this.claudeSessions.get(chatId) : undefined
    if (existingClaudeSession) {
      existingClaudeSession.backgroundTaskIds.clear()
      existingClaudeSession.backgroundTaskDeadlineAt = 0
    }

    // A real user send is a takeover: disarm any armed loop so tools are
    // restored and the generic wake path resumes. Auto-continue / background
    // wakes bypass `send`, so they do NOT disarm.
    // Awaited so a failed event-log write surfaces instead of silently
    // leaving the loop armed (and tools blocked) after the takeover.
    if (chatId) await this.stopLoop(chatId, "user_send")

    logSendToStartingProfile(profile, "chat_send.received", {
      existingChatId: command.chatId ?? null,
      projectId: command.projectId ?? null,
    })

    if (!chatId) {
      if (!command.projectId) {
        throw new Error("Missing projectId for new chat")
      }
      const created = await this.store.createChat(command.projectId)
      chatId = created.id
      this.analytics.track("chat_created")
      logSendToStartingProfile(profile, "chat_send.chat_created", {
        chatId,
        projectId: command.projectId,
      })
    }

    if (typeof command.autoResumeOnRateLimit === "boolean" && chatId) {
      this.autoResumeByChat.set(chatId, command.autoResumeOnRateLimit)
    }

    const chat = this.store.requireChat(chatId)
    if (this.activeTurns.has(chatId)) {
      this.analytics.track("message_sent")
      const queuedMessage = await this.enqueueMessage(chatId, command.content, command.attachments ?? [], {
        provider: command.provider,
        model: command.model,
        modelOptions: command.modelOptions,
        effort: command.effort,
        planMode: command.planMode,
      })
      return { chatId, queuedMessageId: queuedMessage.id, queued: true as const }
    }

    // Mentions no longer short-circuit the main turn. The main agent always
    // runs and decides whether to delegate via `mcp__kanna__delegate_subagent`
    // (Anthropic-style Task-tool pattern). `parseMentions` still runs inside
    // `startTurnForChat` → `appendUserPrompt` so the user_prompt entry
    // continues to carry `subagentMentions` metadata for UI badges + analytics.
    const provider = this.resolveProvider(command, chat.provider)
    const settings = this.getProviderSettings(provider, command)
    this.analytics.track("message_sent")

    // Proactive compact: if the latest usage snapshot crossed claude-code's
    // auto-compact threshold, inject a synthetic `/compact` turn ahead of the
    // user's real message. The user's prompt sits in the queue and runs after
    // `/compact` produces its summary, so the next turn ships with a bounded
    // history instead of looping on "Prompt is too long".
    if (
      provider === "claude" // openrouter intentionally excluded: /compact is claude-CLI-specific
      && this.shouldInjectProactiveCompact(chatId, command.content)
    ) {
      const queuedMessage = await this.enqueueMessage(chatId, command.content, command.attachments ?? [], {
        provider: command.provider,
        model: command.model,
        modelOptions: command.modelOptions,
        effort: command.effort,
        planMode: command.planMode,
      })
      await this.startTurnForChat({
        chatId,
        provider,
        content: "/compact",
        attachments: [],
        model: settings.model,
        effort: settings.effort,
        serviceTier: settings.serviceTier,
        planMode: settings.planMode,
        // /compact is a slash command, not the user's actual message — don't
        // persist a user_prompt transcript entry for it.
        appendUserPrompt: false,
        profile,
      })
      // Tag the active turn so the result handler can update the circuit
      // breaker (reset on success / increment on failure).
      const compactActive = this.activeTurns.get(chatId)
      if (compactActive) compactActive.proactiveCompactInjection = true

      logSendToStartingProfile(profile, "chat_send.proactive_compact_injected", {
        chatId,
        provider,
        model: settings.model,
        queuedUserMessageId: queuedMessage.id,
      })

      return { chatId, queuedMessageId: queuedMessage.id, queued: true as const }
    }

    await this.startTurnForChat({
      chatId,
      provider,
      content: command.content,
      attachments: command.attachments ?? [],
      model: settings.model,
      effort: settings.effort,
      serviceTier: settings.serviceTier,
      planMode: settings.planMode,
      appendUserPrompt: true,
      profile,
    })

    logSendToStartingProfile(profile, "chat_send.ready_for_ack", {
      chatId,
      provider,
      model: settings.model,
    })

    return { chatId }
  }

  private shouldInjectProactiveCompact(chatId: string, content: string): boolean {
    // Never recurse — if the user (or Kanna itself) is already sending a
    // slash command, run it as-is. Compacting before `/clear` or another
    // `/compact` would be wasted work.
    if (content.trimStart().startsWith("/")) return false
    const failures = this.store.getChat(chatId)?.compactFailureCount ?? 0
    if (failures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) return false
    const usage = getLatestContextWindowUsage(this.store.getMessages(chatId))
    return shouldProactivelyCompact(usage)
  }

  /**
   * D6 — subagent Claude starter. When `KANNA_CLAUDE_DRIVER=pty` the
   * subagent turn runs through the PTY driver (subscription billing)
   * instead of always falling back to the SDK (API billing). Adapts the
   * SDK-shaped `startClaudeSession` arg to `StartClaudeSessionPtyArgs`,
   * injecting the coordinator-owned preflight / toolCallback / tunnel /
   * policy context and `oneShot: true` so the REPL closes after the
   * single subagent turn (depends on Phase 4 D7).
   */
  private buildClaudeSubagentStarter(): NonNullable<BuildSubagentProviderRunArgs["startClaudeSession"]> {
    return async (a) => {
      const enabledMcpServers = this.getEnabledCustomMcpServers()
      const oauthBearers = await this.buildOAuthBearers(enabledMcpServers)
      if (this.resolveClaudeDriverPreference() === "pty") {
        return this.startClaudeSessionPTYFn({
          chatId: a.chatId ?? "",
          projectId: a.projectId,
          localPath: a.localPath,
          model: a.model,
          effort: a.effort,
          planMode: a.planMode,
          sessionToken: a.sessionToken,
          forkSession: a.forkSession,
          oauthToken: a.oauthToken,
          additionalDirectories: a.additionalDirectories,
          onToolRequest: a.onToolRequest,
          systemPromptOverride: a.systemPromptOverride,
          initialPrompt: a.initialPrompt,
          subagentOrchestrator: a.subagentOrchestrator,
          delegationContext: a.delegationContext,
          toolCallback: this.toolCallback ?? undefined,
          tunnelGateway: this.tunnelGateway,
          chatPolicy: a.chatId ? this.resolveChatPolicy(a.chatId) : undefined,
          oneShot: true,
          ptyRegistry: this.claudePtyRegistry ?? undefined,
                ptyInstanceRegistry: this.ptyInstanceRegistry ?? undefined,
          workflowRegistry: this.workflowRegistry ?? undefined,
          customMcpServers: enabledMcpServers,
          oauthBearers,
          restrictedAllowedPaths: a.restrictedAllowedPaths,
          keepAlive: a.keepAlive,
        })
      }
      return this.startClaudeSessionFn({ ...a, customMcpServers: enabledMcpServers, oauthBearers })
    }
  }

  private buildSubagentProviderRunForChat(args: {
    subagent: Subagent
    chatId: string
    primer: string | null
    userInstruction: string | null
    runId: string
    abortSignal: AbortSignal
    depth: number
    ancestorSubagentIds: string[]
    parentUserMessageId: string
    /**
     * Orchestration workers run in an isolated git worktree, not the chat cwd.
     * When set, this overrides the resolved cwd, disables workingDir/allowedPaths
     * restriction, and drops additional dirs / stack labelling (the worktree is
     * a self-contained checkout).
     */
    cwdOverride?: string
  }): ProviderRunStart {
    const chat = this.store.requireChat(args.chatId)
    const project = this.store.getProject(chat.projectId)
    if (!project) throw new Error(`Project ${chat.projectId} not found for chat ${args.chatId}`)
    const spawn = resolveSpawnPaths(chat, project.localPath)
    const restriction = args.cwdOverride === undefined
      && (args.subagent.workingDir !== undefined || args.subagent.allowedPaths !== undefined)
      ? resolveSubagentRoots(spawn.cwd, args.subagent.workingDir, args.subagent.allowedPaths, realpathAdapter)
      : null

    const onToolRequest = async (request: HarnessToolRequest): Promise<AnyValue> => {
      if (request.tool.toolKind !== "ask_user_question"
          && request.tool.toolKind !== "exit_plan_mode") {
        // Non-interactive tools (bash, read, write, ...) — SDK handles
        // them via canUseTool wrapper. No forwarding needed.
        return null
      }
      const toolUseId = request.tool.toolId
      const key = this.subagentPendingKey(args.chatId, args.runId, toolUseId)
      await this.store.appendSubagentEvent({
        v: 3,
        type: "subagent_tool_pending",
        timestamp: Date.now(),
        chatId: args.chatId,
        runId: args.runId,
        toolUseId,
        toolKind: request.tool.toolKind,
        input: request.tool.input,
      })
      this.emitStateChange(args.chatId)
      this.subagentOrchestrator.notifySubagentToolPending(args.runId)
      return await new Promise<AnyValue>((resolve, reject) => {
        // Defensive: if `canUseTool` somehow fires twice for the same
        // (chatId, runId, toolUseId) — e.g. SDK retry — reject the previous
        // resolver before overwriting so its Promise doesn't leak.
        const existing = this.subagentPendingResolvers.get(key)
        if (existing) {
          existing.reject(new Error("superseded by retry"))
        }
        this.subagentPendingResolvers.set(key, { resolve, reject })
      })
    }

    const delegationContext: KannaMcpDelegationContext = {
      parentSubagentId: args.subagent.id,
      parentRunId: args.runId,
      ancestorSubagentIds: [...args.ancestorSubagentIds, args.subagent.id],
      depth: args.depth + 1,
      // For sub-spawn-sub, the parent_user_message_id stays anchored to the
      // chat turn that started the whole chain — that's the attribution the
      // run_started events use, and the orchestrator's depth/cycle checks
      // protect against runaway chains.
      getParentUserMessageId: () => args.parentUserMessageId,
      // Subagents cannot inherit the user's @-mention authority: manual-trigger
      // gates are enforced only at the top-level turn where the user typed the mention.
      getMentionedSubagentIds: () => [],
    }

    return buildSubagentProviderRun({
      subagent: args.subagent,
      chatId: args.chatId,
      primer: args.primer,
      userInstruction: args.userInstruction,
      runId: args.runId,
      abortSignal: args.abortSignal,
      cwd: args.cwdOverride ?? restriction?.cwd ?? spawn.cwd,
      additionalDirectories: args.cwdOverride ? [] : spawn.additionalDirectories,
      // Only label stack projects for unrestricted runs — a path-restricted
      // subagent cannot reach every root, so listing them all would mislead.
      stackProjects: args.cwdOverride || restriction ? [] : resolveStackProjects(chat, (id) => this.store.getProject(id)?.title),
      allowedPaths: restriction?.allowedPaths,
      projectId: project.id,
      startClaudeSession: this.buildClaudeSubagentStarter(),
      // PTY claude has no native maxTurns (interactive CLI) — the orchestrator
      // applies a host-side tool-call-count backstop for PTY + Codex runs.
      claudeDriverIsPty: this.resolveClaudeDriverPreference() === "pty",
      subagentOrchestrator: this.subagentOrchestrator,
      delegationContext,
      codexManager: this.codexManager,
      onToolRequest,
      globalPromptAppend: this.getAppSettingsSnapshot().globalPromptAppend,
      authReady: async (provider) => {
        if (provider === "openrouter") {
          return openrouterAuthReady(await this.readLlmProvider())
        }
        if (provider === "claude") {
          const settings = this.getAppSettingsSnapshot()
          // Pass parent chat id so a token already reserved by the parent
          // counts as usable. Subagent runs are sequential under the parent
          // (parent's turn is paused), so sharing the parent's reservation
          // is correct — see oauth-token-pool isEligible.
          return Boolean(settings.claudeAuth?.authenticated || this.oauthPool?.hasUsable(args.chatId))
        }
        return true
      },
      pickOauthToken: () => {
        // Subagent inherits the parent chat's reservation by re-picking under
        // the same chatId. pickActive treats the parent's reservation as
        // owned-by-self (drops + re-binds to chatId), so the lifecycle stays
        // bound to the parent's close path — no separate subagent release.
        const picked = this.oauthPool?.pickActive(args.chatId) ?? null
        if (this.oauthPool && this.oauthPool.hasAnyToken() && !picked) {
          throw new OAuthPoolUnavailableError(this.buildPoolUnavailableMessage(args.chatId, " for subagent run"))
        }
        if (picked) this.oauthPool!.markUsed(picked.id)
        return picked?.token ?? null
      },
    })
  }

  /**
   * StartWorker adapter for the OrchestrationQueue: spawn the run's configured
   * worker subagent against the task worktree (`spawn.cwd`) with the phase
   * prompt. Origin chat + subagent are read from the persisted run config so
   * this resolves identically on a fresh run and after a restart.
   */
  private async buildOrchWorker(spawn: WorkerSpawnArgs): Promise<WorkerResult> {
    const run = this.store.getOrchRun(spawn.runId)
    const chatId = run?.config.originChatId
    const subagentId = run?.config.workerSubagentId
    if (!chatId || !subagentId) {
      return { kind: "failed", error: "orchestration run missing originChatId / workerSubagentId" }
    }
    const subagent = this.getSubagents().find((s) => s.id === subagentId)
    if (!subagent) return { kind: "failed", error: `orchestration worker subagent "${subagentId}" not found` }
    if (!this.store.getChat(chatId)) return { kind: "failed", error: `orchestration origin chat ${chatId} not found` }

    const providerRun = this.buildSubagentProviderRunForChat({
      subagent,
      chatId,
      primer: null,
      userInstruction: spawn.prompt,
      runId: `${spawn.runId}:${spawn.workerId}`,
      abortSignal: spawn.abortSignal,
      depth: 0,
      ancestorSubagentIds: [],
      parentUserMessageId: spawn.runId,
      cwdOverride: spawn.cwd,
    })
    try {
      if (!(await providerRun.authReady())) {
        return { kind: "failed", error: "orchestration worker auth not ready" }
      }
      const result = await providerRun.start(() => undefined, () => undefined)
      return { kind: "completed", text: result.text }
    } catch (err) {
      if (spawn.abortSignal.aborted) return { kind: "failed", error: "aborted" }
      return { kind: "failed", error: err instanceof Error ? err.message : String(err) }
    }
  }

  private buildOrchRunContext(chatId: string): OrchRunContext | null {
    const chat = this.store.getChat(chatId)
    if (!chat) return null
    const project = this.store.getProject(chat.projectId)
    if (!project) return null
    return {
      chatId,
      repoRoot: project.localPath,
      roster: this.getSubagents().map((s) => ({ id: s.id, name: s.name })),
      defaultOrchSubagentId: this.getAppSettingsSnapshot().subagentRuntime?.defaultOrchSubagentId ?? null,
    }
  }

  /**
   * User-callable entry point (MCP `orch_run` + ws `orch.run`). Validates the
   * task list into the fixed linear config, then starts the run. Returns the
   * runId or the flat validation error list — never a partial run.
   */
  async runOrchestration(
    chatId: string,
    input: OrchRunInput,
  ): Promise<{ ok: true; runId: string } | { ok: false; errors: string[] }> {
    const context = this.buildOrchRunContext(chatId)
    if (!context) return { ok: false, errors: [`chat ${chatId} not found or has no project`] }
    const validation = validateOrchRun(input, context)
    if (!validation.ok) return { ok: false, errors: validation.errors }
    const runId = await this.orchestrationQueue.createRun(validation.resolved.config, validation.resolved.tasks)
    return { ok: true, runId }
  }

  /** Cancel a run (MCP `orch_cancel_run` + ws `orch.cancelRun`). */
  async cancelOrchRun(runId: string): Promise<void> {
    await this.orchestrationQueue.cancelRun(runId)
  }

  /** Canonical run detail DTO (MCP `orch_run_status` + ws `orch.getRun`). */
  getOrchRunDetail(runId: string): OrchRunDetail | null {
    const snapshot = this.store.getOrchRun(runId)
    return snapshot ? toOrchRunDetail(snapshot) : null
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
    const queuedMessage = this.store.getQueuedMessage(command.chatId, command.queuedMessageId)
    if (!queuedMessage) {
      throw new Error("Queued message not found")
    }

    logClaudeSteer("steer_requested", {
      chatId: command.chatId,
      queuedMessageId: command.queuedMessageId,
      activeTurn: this.activeTurns.has(command.chatId),
      queuedMessagePreview: queuedMessage.content.slice(0, 160),
    })

    if (this.activeTurns.has(command.chatId)) {
      await this.cancel(command.chatId, { hideInterrupted: true, skipQueueDrain: true })
    }

    logClaudeSteer("steer_after_cancel", {
      chatId: command.chatId,
      stillActive: this.activeTurns.has(command.chatId),
    })

    if (this.activeTurns.has(command.chatId)) {
      throw new Error("Chat is still running")
    }

    await this.dequeueAndStartQueuedMessage(command.chatId, queuedMessage, { steered: true })
  }

  async dequeue(command: Extract<ClientCommand, { type: "message.dequeue" }>) {
    const queuedMessage = this.store.getQueuedMessage(command.chatId, command.queuedMessageId)
    if (!queuedMessage) {
      throw new Error("Queued message not found")
    }

    // Refuse to drop the queued message while a Kanna-injected `/compact`
    // turn is running. The compact was triggered specifically to make room
    // for this queued message; auto-draining it after compact completes
    // would silently lose user intent and waste the compact spend.
    const active = this.activeTurns.get(command.chatId)
    if (active?.proactiveCompactInjection) {
      throw new Error("Cannot remove queued message while compact is running")
    }

    await this.store.removeQueuedMessage(command.chatId, command.queuedMessageId)
  }

  async forkChat(chatId: string) {
    const chat = this.store.requireChat(chatId)
    if (this.activeTurns.has(chatId) || this.drainingStreams.has(chatId)) {
      throw new Error("Chat must be idle before forking")
    }
    if (!chat.provider) {
      throw new Error("Chat must have a provider before forking")
    }
    const currentProviderToken = chat.provider
      ? chat.sessionTokensByProvider[chat.provider] ?? null
      : null
    const pendingForkForProvider = chat.pendingForkSessionToken?.provider === chat.provider
      ? chat.pendingForkSessionToken.token
      : null
    if (!currentProviderToken && !pendingForkForProvider) {
      throw new Error("Chat has no session to fork")
    }

    const forked = await this.store.forkChat(chatId)
    this.analytics.track("chat_created")
    return { chatId: forked.id }
  }

  private async runClaudeSession(session: ClaudeSessionState) {
    return runClaudeSessionLoop({
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
    }, session)
  }

  private async generateTitleInBackground(chatId: string, messageContent: string, cwd: string, expectedCurrentTitle: string) {
    try {
      const result = await this.generateTitle(messageContent, cwd)
      if (result.failureMessage) {
        this.reportBackgroundError?.(
          `[title-generation] chat ${chatId} failed provider title generation: ${result.failureMessage}`
        )
      }
      if (!result.title || result.usedFallback) return

      const chat = this.store.requireChat(chatId)
      if (chat.title !== expectedCurrentTitle) return

      await this.store.renameChat(chatId, result.title)
      this.emitStateChange(chatId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.reportBackgroundError?.(
        `[title-generation] chat ${chatId} failed background title generation: ${message}`
      )
    }
  }

  private async runTurn(active: ActiveTurn) {
    try {
      for await (const event of active.turn.stream) {
        // Once cancelled, stop processing further stream events.
        // cancel() already removed us from activeTurns and notified the UI.
        if (active.cancelRequested) break

        if (event.type === "session_token" && event.sessionToken) {
          await this.store.setSessionTokenForProvider(active.chatId, active.provider, event.sessionToken)
          const chat = this.store.getChat(active.chatId)
          if (
            chat?.pendingForkSessionToken
            && event.sessionToken !== chat.pendingForkSessionToken.token
          ) {
            await this.store.setPendingForkSessionToken(active.chatId, null)
          }
          this.emitStateChange(active.chatId)
          continue
        }

        if (!event.entry) continue
        await this.store.appendMessage(active.chatId, event.entry)

        if (event.entry.kind === "system_init") {
          active.status = "running"
        }

        if (event.entry.kind === "result") {
          active.hasFinalResult = true
          if (event.entry.isError) {
            await this.store.recordTurnFailed(active.chatId, event.entry.result || "Turn failed")
          } else if (!active.cancelRequested) {
            await this.store.recordTurnFinished(active.chatId)
          }
          // Remove from activeTurns as soon as the result arrives so the UI
          // transitions to idle immediately. The stream may still be open
          // (e.g. background tasks), but the user should be able to send
          // new messages without having to hit stop first.
          this.activeTurns.delete(active.chatId)
          this.drainingStreams.set(active.chatId, { turn: active.turn })
        }

        this.emitStateChange(active.chatId)
      }
    } catch (error) {
      if (!active.cancelRequested) {
        const handled = await this.handleLimitError(active.chatId, this.codexLimitDetector, error)
        if (!handled) {
          const message = error instanceof Error ? error.message : String(error)
          await this.store.appendMessage(
            active.chatId,
            timestamped({
              kind: "result",
              subtype: "error",
              isError: true,
              durationMs: 0,
              result: message,
            })
          )
          await this.store.recordTurnFailed(active.chatId, message)
        } else {
          await this.store.recordTurnFailed(active.chatId, "rate_limit")
        }
      }
    } finally {
      if (active.cancelRequested && !active.cancelRecorded) {
        await this.store.recordTurnCancelled(active.chatId)
      }
      active.turn.close()
      // Only remove if we're still the active turn for this chat.
      // We may have already been removed by result handling or cancel(),
      // and a new turn may have started for the same chatId.
      if (this.activeTurns.get(active.chatId) === active) {
        this.activeTurns.delete(active.chatId)
      }
      // Stream has fully ended — no longer draining.
      this.clearDrainingStream(active.chatId)
      // Turn-scoped reservation: release so another chat can claim this
      // token while this chat is idle. The rotation race between concurrent
      // in-flight turns is still serialized — both startClaudeTurn and the
      // pickActive() inside markLimited/markError run atomically in the JS
      // event loop, and a token marked limited/errored already drops its
      // reservation. The next turn for this chat reuses its existing claude
      // session (no re-pick) or pickActive again if it needs a fresh one.
      this.oauthPool?.release(active.chatId)
      this.emitStateChange(active.chatId)

      if (active.postToolFollowUp && !active.cancelRequested) {
        try {
          await this.startTurnForChat({
            chatId: active.chatId,
            provider: active.provider,
            content: active.postToolFollowUp.content,
            attachments: [],
            model: active.model,
            effort: active.effort,
            serviceTier: active.serviceTier,
            planMode: active.postToolFollowUp.planMode,
            appendUserPrompt: false,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await this.store.appendMessage(
            active.chatId,
            timestamped({
              kind: "result",
              subtype: "error",
              isError: true,
              durationMs: 0,
              result: message,
            })
          )
          await this.store.recordTurnFailed(active.chatId, message)
          this.emitStateChange(active.chatId)
        }
      } else if (!active.cancelRequested) {
        try {
          await this.maybeStartNextQueuedMessage(active.chatId)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await this.store.appendMessage(
            active.chatId,
            timestamped({
              kind: "result",
              subtype: "error",
              isError: true,
              durationMs: 0,
              result: message,
            })
          )
          await this.store.recordTurnFailed(active.chatId, message)
          this.emitStateChange(active.chatId)
        }
      }
    }
  }

  private resolveAutoResumeFor(chatId: string): boolean {
    const cached = this.autoResumeByChat.get(chatId)
    if (typeof cached === "boolean") return cached
    return this.getAutoResumePreference()
  }

  private async emitAutoContinueEvent(event: AutoContinueEvent): Promise<void> {
    await this.store.appendAutoContinueEvent(event)
    this.scheduleManager?.onEvent(event)
    this.emitStateChange(event.chatId)
  }

  private getChatSchedule(chatId: string, scheduleId: string) {
    const events = this.store.getAutoContinueEvents(chatId)
    return deriveChatSchedules(events, chatId).schedules[scheduleId]
  }

  private requireFuture(scheduledAt: number): void {
    if (scheduledAt <= Date.now()) throw new Error("scheduledAt must be in the future")
  }

  /**
   * Returns the additional scheduling delay (ms) for a respawn caused by a
   * rotation event on `tokenId`. The first detector in a
   * TOKEN_ROTATION_DEDUPE_WINDOW_MS window gets 0; each later detector gets
   * an additional TOKEN_ROTATION_HERD_STAGGER_MS so PTY cold-boots spread
   * out instead of stampeding. Also reports whether this caller is the
   * first detector (used to skip duplicate markLimited/markError calls).
   */
  private acquireRotationSlot(tokenId: string | null): { extraDelayMs: number; isFirst: boolean } {
    if (!tokenId) return { extraDelayMs: 0, isFirst: true }
    const now = Date.now()
    const existing = this.tokenRotationDedupe.get(tokenId)
    if (!existing || now - existing.firstSeenAt > TOKEN_ROTATION_DEDUPE_WINDOW_MS) {
      this.tokenRotationDedupe.set(tokenId, { firstSeenAt: now, staggerCount: 0 })
      return { extraDelayMs: 0, isFirst: true }
    }
    existing.staggerCount += 1
    return { extraDelayMs: existing.staggerCount * TOKEN_ROTATION_HERD_STAGGER_MS, isFirst: false }
  }

  private async handleLimitError(chatId: string, detector: LimitDetector, error: AnyValue): Promise<boolean> {
    const detection = detector.detect(chatId, error)
    if (!detection) return false
    return this.handleLimitDetection(chatId, detection)
  }

  private async handleLimitDetection(chatId: string, detection: LimitDetection): Promise<boolean> {
    const live = deriveChatSchedules(this.store.getAutoContinueEvents(chatId), chatId).liveScheduleId
    if (live !== null) return true

    const session = this.claudeSessions.get(chatId)
    const limitedTokenId = session?.activeTokenId ?? null
    const slot = this.acquireRotationSlot(limitedTokenId)
    if (this.oauthPool && limitedTokenId && slot.isFirst) {
      this.oauthPool.markLimited(limitedTokenId, detection.resetAt)
    }
    const rotationTarget = this.oauthPool?.pickActive(chatId) ?? null
    const canRotate = rotationTarget !== null
      && (!limitedTokenId || rotationTarget.id !== limitedTokenId)

    if (this.oauthPool) {
      log.info("[oauth-pool] rate-limit detected", {
        chatId,
        markedLimitedTokenId: limitedTokenId,
        resetAt: new Date(detection.resetAt).toISOString(),
        tz: detection.tz,
        nextTokenId: rotationTarget?.id ?? null,
        canRotate,
        herdSlot: slot,
      })
    }

    const now = Date.now()
    const scheduleId = crypto.randomUUID()
    const base = { v: AUTO_CONTINUE_EVENT_VERSION, timestamp: now, chatId, scheduleId }

    // When no rotation is possible, "wait until rate-limit clears" means waiting
    // for the earliest token in the pool to become available again — not just
    // the current detection's resetAt, which would over-shoot if another pool
    // token has an earlier limitedUntil.
    const earliestPoolUnlimit = this.oauthPool?.earliestUnlimit() ?? null
    const waitUntil = earliestPoolUnlimit !== null
      ? Math.min(detection.resetAt, earliestPoolUnlimit)
      : detection.resetAt

    let event: AutoContinueEvent
    if (canRotate) {
      event = {
        ...base,
        kind: "auto_continue_accepted",
        scheduledAt: now + TOKEN_ROTATION_SCHEDULE_DELAY_MS + slot.extraDelayMs,
        tz: detection.tz,
        source: "token_rotation",
        resetAt: detection.resetAt,
        detectedAt: now,
      }
    } else if (this.resolveAutoResumeFor(chatId)) {
      event = {
        ...base,
        kind: "auto_continue_accepted",
        scheduledAt: waitUntil,
        tz: detection.tz,
        source: "auto_setting",
        resetAt: waitUntil,
        detectedAt: now,
      }
    } else {
      event = {
        ...base,
        kind: "auto_continue_proposed",
        detectedAt: now,
        resetAt: waitUntil,
        tz: detection.tz,
      }
    }

    await this.emitAutoContinueEvent(event)
    if (canRotate && session) {
      // Tear down the session bound to the limited token so the next turn
      // spawns a fresh subprocess with the rotated token's credentials.
      // Without this, startClaudeTurn reuses the cached session and
      // sendPrompt is routed to the still-limited token's subprocess.
      // keepReservation: true — the `pickActive(chatId)` above already
      // claimed `rotationTarget` under this chatId; the default `release`
      // path would scan reservedBy for owner===chatId and drop it,
      // leaking the rotation's reservation (audit #9d).
      this.closeClaudeSession(chatId, session, { keepReservation: true })
      const active = this.activeTurns.get(chatId)
      if (active) {
        await this.store.recordTurnFailed(chatId, "rate_limit")
        this.activeTurns.delete(chatId)
      }
    }
    if (!canRotate) {
      await this.store.appendMessage(chatId, timestamped({
        kind: "auto_continue_prompt",
        scheduleId,
      }))
    }

    return true
  }

  /**
   * Handle an OAuth 401 / authentication failure on a live Claude session:
   *   1. Mark the offending token as `error` in the pool so subsequent
   *      pickActive() calls skip it.
   *   2. Try to rotate to another usable token. If one exists, tear down
   *      the dead session and schedule an immediate auto-continue with
   *      source `token_rotation` (mirrors the rate-limit rotation path).
   *   3. If no rotation target exists, surface an auto_continue_proposed
   *      event so the UI can prompt the user to fix their token pool
   *      instead of looping silently.
   *
   * Returns true when the failure was handled (rotated or proposed),
   * false otherwise (caller logs the raw error).
   */
  private async handleAuthFailure(
    session: ClaudeSessionState,
    detection: AuthErrorDetection,
  ): Promise<boolean> {
    const chatId = session.chatId
    const live = deriveChatSchedules(this.store.getAutoContinueEvents(chatId), chatId).liveScheduleId
    if (live !== null) return true

    const erroredTokenId = session.activeTokenId
    const slot = this.acquireRotationSlot(erroredTokenId)
    if (this.oauthPool && erroredTokenId && slot.isFirst) {
      this.oauthPool.markError(erroredTokenId, detection.reason)
    }
    const rotationTarget = this.oauthPool?.pickActive(chatId) ?? null
    const canRotate = rotationTarget !== null
      && (!erroredTokenId || rotationTarget.id !== erroredTokenId)

    if (this.oauthPool) {
      log.info("[oauth-pool] auth-error detected", {
        chatId,
        markedErrorTokenId: erroredTokenId,
        reason: detection.reason,
        nextTokenId: rotationTarget?.id ?? null,
        canRotate,
        herdSlot: slot,
      })
    }

    const now = Date.now()
    const scheduleId = crypto.randomUUID()
    const base = { v: AUTO_CONTINUE_EVENT_VERSION, timestamp: now, chatId, scheduleId }

    // Auth errors mean the token is dead, not throttled — rotate
    // immediately when possible, no wait window.
    const event: AutoContinueEvent = canRotate
      ? {
          ...base,
          kind: "auto_continue_accepted",
          scheduledAt: now + TOKEN_ROTATION_SCHEDULE_DELAY_MS + slot.extraDelayMs,
          tz: "system",
          source: "token_rotation",
          resetAt: now,
          detectedAt: now,
        }
      : {
          ...base,
          kind: "auto_continue_proposed",
          detectedAt: now,
          resetAt: now,
          tz: "system",
        }

    await this.emitAutoContinueEvent(event)
    if (canRotate) {
      // Tear down the session bound to the dead token so the next turn
      // spawns a fresh subprocess with the rotated token in env.
      // keepReservation: true — `pickActive(chatId)` above already claimed
      // the rotation target under this chatId. The previous inline close +
      // delete pair sidestepped `closeClaudeSession` to avoid the
      // accidental release; route through the helper now that release is
      // opt-out, for symmetry with the rate-limit rotation path.
      this.closeClaudeSession(chatId, session, { keepReservation: true })
      const active = this.activeTurns.get(chatId)
      if (active) {
        await this.store.recordTurnFailed(chatId, "auth_error")
        this.activeTurns.delete(chatId)
      }
    }
    if (!canRotate) {
      await this.store.appendMessage(chatId, timestamped({
        kind: "auto_continue_prompt",
        scheduleId,
      }))
    }

    return true
  }

  async fireAutoContinue(chatId: string, scheduleId: string) {
    if (!this.store.getChat(chatId)) return

    // `subagent_background` deliveries carry the "Read PROGRESS.md" prompt;
    // provider-failure schedules carry none and fall back to the literal "continue".
    const schedule = this.getChatSchedule(chatId, scheduleId)
    const promptToReplay = schedule?.prompt ?? "continue"

    const event: AutoContinueEvent = {
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_fired",
      timestamp: Date.now(),
      chatId,
      scheduleId,
    }
    try {
      await this.store.appendAutoContinueEvent(event)
      await this.enqueueMessage(chatId, promptToReplay, [], { autoContinue: { scheduleId } })
      await this.maybeStartNextQueuedMessage(chatId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.store.appendMessage(chatId, timestamped({
        kind: "result",
        subtype: "error",
        isError: true,
        durationMs: 0,
        result: `Auto-continue failed: ${message}`,
      }))
    }

    this.emitStateChange(chatId)
  }

  async acceptAutoContinue(chatId: string, scheduleId: string, scheduledAt: number): Promise<void> {
    const schedule = this.getChatSchedule(chatId, scheduleId)
    if (!schedule) throw new Error("Schedule not found")
    if (schedule.state !== "proposed") throw new Error("Schedule not pending")
    this.requireFuture(scheduledAt)

    await this.emitAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_accepted",
      timestamp: Date.now(),
      chatId,
      scheduleId,
      scheduledAt,
      tz: schedule.tz,
      source: "user",
      resetAt: schedule.resetAt,
      detectedAt: schedule.detectedAt,
    })
  }

  async rescheduleAutoContinue(chatId: string, scheduleId: string, scheduledAt: number): Promise<void> {
    const schedule = this.getChatSchedule(chatId, scheduleId)
    if (!schedule || schedule.state !== "scheduled") throw new Error("Schedule not active")
    this.requireFuture(scheduledAt)

    await this.emitAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_rescheduled",
      timestamp: Date.now(),
      chatId,
      scheduleId,
      scheduledAt,
    })
  }

  async cancelAutoContinue(chatId: string, scheduleId: string, reason: "user" | "chat_deleted"): Promise<void> {
    const schedule = this.getChatSchedule(chatId, scheduleId)
    if (!schedule) return
    if (schedule.state !== "proposed" && schedule.state !== "scheduled") return

    await this.emitAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "auto_continue_cancelled",
      timestamp: Date.now(),
      chatId,
      scheduleId,
      reason,
    })
  }

  /**
   * The /clear machinery for the loop-orchestration paths (setup_loop,
   * background delivery). Wiping the store token alone is not enough:
   * - an in-flight turn keeps streaming and its next `session_token` event
   *   would re-persist the OLD conversation's token over the wipe (observed
   *   121 ms after a setup_loop /clear) — so suppress persistence on the
   *   live session for the rest of its life;
   * - an idle warm SDK session would be reused in-band by the next turn,
   *   making the /clear a no-op — so tear it down when no turn is active.
   */
  private async clearClaudeSessionContext(chatId: string): Promise<void> {
    await this.store.setSessionTokenForProvider(chatId, "claude", null)
    const session = this.claudeSessions.get(chatId)
    if (!session) return
    session.suppressSessionTokenPersist = true
    if (!this.activeTurns.has(chatId)) {
      this.closeClaudeSession(chatId, session)
    }
  }

  /**
   * Deliver a finished `run_in_background` subagent's result back into the
   * main chat as a fresh turn AND clear the main-agent's Claude session so the
   * next turn starts with a fresh context window. Wired as the orchestrator's
   * `onBackgroundRunComplete` hook.
   *
   * Loop-orchestration invariant: main is stateless-in-context / stateful-in-file.
   * PROGRESS.md is the durability contract; every delivery re-reads it. Subagent
   * output is NOT carried forward as prompt content — the subagent is expected
   * to have written its findings into PROGRESS.md before terminating.
   *
   * See adr-20260711-notification-driven-loop-orchestration.
   */
  private async deliverSubagentToMain(
    chatId: string,
    runId: string,
    outcome: BackgroundRunOutcome,
  ): Promise<void> {
    if (!this.store.getChat(chatId)) return

    // Structured re-entry: the completion is delivered as the same
    // <task-notification> XML Claude Code's own background agents use
    // (LocalAgentTask), so the model parses task identity/status with the
    // format it already knows from native training.
    //
    // When a loop is armed, the FULL loop discipline prompt follows the
    // notification on every wake — not a generic "decide next action" string,
    // which drifted into self-implementation (the 7.5h marathon-turn bug).
    // Armed notifications carry NO <result> body: PROGRESS.md is the loop's
    // only durability contract. Non-loop deliveries include the (truncated)
    // result since ad-hoc background delegations have no tracking file.
    const armed = this.isLoopArmed(chatId)
    const notification = buildTaskNotification(runId, outcome, { includeResult: !armed })
    let prompt: string
    if (armed) {
      prompt = `${notification}\n\n${armed.prompt}`
    } else if (outcome.status === "completed") {
      prompt = `${notification}\n\nYour Claude context has been cleared. Read PROGRESS.md if present, then decide the next action.`
    } else {
      prompt = `${notification}\n\nYour Claude context has been cleared. Read PROGRESS.md if present; decide whether to retry, try another approach, or stop.`
    }

    try {
      // Wipe the main-agent's Claude session token so the next spawn starts
      // fresh (the /clear equivalent). Codex path is unaffected.
      await this.clearClaudeSessionContext(chatId)
      await this.store.appendMessage(chatId, timestamped({ kind: "context_cleared" }))

      const now = Date.now()
      const scheduleId = crypto.randomUUID()
      await this.emitAutoContinueEvent({
        v: AUTO_CONTINUE_EVENT_VERSION,
        kind: "auto_continue_accepted",
        timestamp: now,
        chatId,
        scheduleId,
        scheduledAt: now,
        tz: "system",
        source: "subagent_background",
        resetAt: now,
        detectedAt: now,
        prompt,
      })
    } catch (err) {
      log.warn(`${LOG_PREFIX} deliverSubagentToMain failed`, { chatId, runId, err })
    }
  }

  /**
   * Arm an autonomous loop on the main chat. Validates the loop spec, ensures
   * the tracking file exists (writes a skeleton if absent), then /clears the
   * main-agent Claude session and enqueues the templated recurring prompt so
   * the next turn starts the loop. Backs `mcp__kanna__setup_loop`. See
   * adr-20260711-setup-loop-template.
   */
  async setupLoop(args: {
    chatId: string
    input: LoopSetupInput
  }): Promise<SetupLoopHandlerResult> {
    const chat = this.store.getChat(args.chatId)
    if (!chat) return { ok: false, errors: [`chat ${args.chatId} not found`] }
    const project = this.store.getProject(chat.projectId)
    if (!project) return { ok: false, errors: [`project ${chat.projectId} not found`] }

    const validation = validateLoopSetup(args.input, project.localPath, {
      roster: this.getSubagents().map((s) => ({ id: s.id, name: s.name })),
      defaultLoopSubagentId: this.getAppSettingsSnapshot().subagentRuntime?.defaultLoopSubagentId ?? null,
    })
    if (!validation.ok) return { ok: false, errors: validation.errors }

    const resolved = validation.resolved
    let created: boolean
    let reconciled: boolean
    let reconcileActions: string[]
    try {
      const ensureResult = await ensureTrackingFile({
        absPath: resolved.trackingFileAbs,
        skeleton: resolved.skeleton,
        // Deterministic schema reconcile of an EXISTING tracking file: pure
        // string transform — server-owned sections rewritten to the inputs,
        // loop history preserved. No model judgement involved.
        reconcile: (existing) =>
          reconcileTrackingFile(existing, {
            goal: resolved.goal,
            verifyCommand: resolved.verifyCommand,
            chunkHint: resolved.chunkHint,
          }),
      })
      created = ensureResult.created
      reconciled = ensureResult.reconciled
      reconcileActions = ensureResult.actions
    } catch (err) {
      return {
        ok: false,
        errors: [`ensureTrackingFile failed: ${err instanceof Error ? err.message : String(err)}`],
      }
    }

    try {
      // Wipe main-agent Claude session so the next turn starts fresh with the
      // rendered loop prompt. Codex untouched. setup_loop runs from INSIDE a
      // live turn, so the suppression half of clearClaudeSessionContext is
      // what keeps the wipe from being overwritten by the in-flight stream.
      await this.clearClaudeSessionContext(args.chatId)
      await this.store.appendMessage(args.chatId, timestamped({ kind: "context_cleared" }))

      const now = Date.now()
      // Arm the loop durably: every subsequent background-completion wake
      // re-injects THIS prompt (not the generic one) and loop turns are
      // tool-blocked. Superseded by a later setup_loop or cleared by stop_loop
      // / a real user send. Replays from the auto-continue log on restart.
      await this.emitAutoContinueEvent({
        v: AUTO_CONTINUE_EVENT_VERSION,
        kind: "loop_armed",
        timestamp: now,
        chatId: args.chatId,
        scheduleId: crypto.randomUUID(),
        subagentId: resolved.subagentId,
        prompt: resolved.prompt,
      })

      const scheduleId = crypto.randomUUID()
      await this.emitAutoContinueEvent({
        v: AUTO_CONTINUE_EVENT_VERSION,
        kind: "auto_continue_accepted",
        timestamp: now,
        chatId: args.chatId,
        scheduleId,
        scheduledAt: now,
        tz: "system",
        source: "subagent_background",
        resetAt: now,
        detectedAt: now,
        prompt: resolved.prompt,
      })
    } catch (err) {
      return {
        ok: false,
        errors: [`enqueue failed: ${err instanceof Error ? err.message : String(err)}`],
      }
    }

    return {
      ok: true,
      trackingFileRel: resolved.trackingFileRel,
      created,
      reconciled,
      reconcileActions,
      prompt: resolved.prompt,
    }
  }

  /** Current armed-loop state for a chat, or null. Pure replay of the auto-continue log. */
  isLoopArmed(chatId: string): LoopState | null {
    return deriveLoopState(this.store.getAutoContinueEvents(chatId), chatId)
  }

  /**
   * Disarm an armed loop (restores tools + stops prompt re-injection). Backs
   * the `stop_loop` MCP tool (called by the model on GOAL MET) and the
   * user-send takeover path. No-op when no loop is armed.
   */
  async stopLoop(chatId: string, reason: "goal_met" | "user_send" | "chat_deleted"): Promise<void> {
    if (!this.isLoopArmed(chatId)) return
    await this.emitAutoContinueEvent({
      v: AUTO_CONTINUE_EVENT_VERSION,
      kind: "loop_disarmed",
      timestamp: Date.now(),
      chatId,
      scheduleId: crypto.randomUUID(),
      reason,
    })
  }

  listLiveSchedules(chatId: string): string[] {
    const { schedules } = deriveChatSchedules(this.store.getAutoContinueEvents(chatId), chatId)
    return Object.values(schedules)
      .filter((s) => s.state === "proposed" || s.state === "scheduled")
      .map((s) => s.scheduleId)
      .sort()
  }

  async killPtyInstance(chatId: string): Promise<void> {
    const instance = this.ptyInstanceRegistry?.snapshot().find((entry) => entry.chatId === chatId)
    if (!instance || instance.pid === null) {
      throw new Error("No live PTY instance for chat")
    }
    const { killProcessTree } = await import("./claude-pty/pid-registry.adapter")
    await killProcessTree(instance.pid)
    this.ptyInstanceRegistry?.markExitedIfCurrent(chatId, instance.pid, {
      phase: "exited",
      exitedAt: Date.now(),
      lastEventAt: Date.now(),
    })
  }

  async cancel(chatId: string, options?: { hideInterrupted?: boolean; skipQueueDrain?: boolean }) {
    // Also clean up any draining stream for this chat.
    const draining = this.drainingStreams.get(chatId)
    if (draining) {
      draining.turn.close()
      this.clearDrainingStream(chatId)
    }

    // Reject any subagent canUseTool Promises waiting on a user response in
    // this chat, and signal the orchestrator. Both happen unconditionally —
    // a chat may have no active main-turn (e.g. just an @mention with the
    // main turn already ended) while subagents are still running. Without
    // this, the SDK's canUseTool callback hangs forever, wedging the
    // subagent session and leaking the resolver entry.
    this.rejectPendingResolversForChat(chatId)
    this.subagentOrchestrator.cancelChat(chatId)

    const active = this.activeTurns.get(chatId)
    if (!active) return

    logClaudeSteer("cancel_requested", {
      chatId,
      provider: active.provider,
      activePromptSeq: active.claudePromptSeq ?? null,
    })

    // Guard against concurrent cancel() calls — only the first one does work.
    if (active.cancelRequested) return
    active.cancelRequested = true

    const pendingTool = active.pendingTool
    active.pendingTool = null

    if (pendingTool) {
      const result = discardedToolResult(pendingTool.tool)
      await this.store.appendMessage(
        chatId,
        timestamped({
          kind: "tool_result",
          toolId: pendingTool.toolUseId,
          content: result,
        })
      )
      if (active.provider === "codex" && pendingTool.tool.toolKind === "exit_plan_mode") {
        pendingTool.resolve(result)
      }
    }

    await this.store.appendMessage(chatId, timestamped({ kind: "interrupted", hidden: options?.hideInterrupted }))
    await this.store.recordTurnCancelled(chatId)
    active.cancelRecorded = true
    active.hasFinalResult = true

    // Remove from activeTurns immediately so the UI reflects the cancellation
    // right away, rather than waiting for interrupt() which may hang.
    this.activeTurns.delete(chatId)

    // Drain the cancelled prompt's seq from the Claude session's pending
    // queue. The SDK does not always echo a `result.subtype=cancelled` for
    // an interrupted prompt — when the stream just ends, the seq would
    // otherwise linger and cause a FIFO mismatch when the next turn's
    // result arrives, leaving the chat stuck in "running".
    if (active.provider === "claude" && active.claudePromptSeq != null) {
      const session = this.claudeSessions.get(chatId)
      if (session) {
        const idx = session.pendingPromptSeqs.indexOf(active.claudePromptSeq)
        if (idx >= 0) session.pendingPromptSeqs.splice(idx, 1)
        // The SDK driver's `interrupt()` emits a tail `result` with
        // subtype `error_during_execution` (empty text) after the splice
        // above. Mark it pending so runClaudeSession suppresses that one
        // result instead of rendering "An unknown error occurred." The
        // `interrupted` entry above is the user-visible cancellation.
        session.cancelledResultPending += 1
      }
    }

    this.emitStateChange(chatId)
    logClaudeSteer("cancel_active_turn_deleted", {
      chatId,
      provider: active.provider,
      activePromptSeq: active.claudePromptSeq ?? null,
    })

    // Now attempt to interrupt/close the underlying stream in the background.
    // This is best-effort — the turn is already removed from active state above,
    // and runTurn()'s finally block will also call close().
    try {
      await Promise.race([
        active.turn.interrupt(),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ])
    } catch {
      // interrupt() failed — force close
    }
    active.turn.close()

    // For Claude under the PTY driver, `active.turn` is a ghost facade over
    // the long-lived `claudeSessions` entry and its `close()` is a no-op.
    // The PTY driver's `interrupt()` sends SIGINT which terminates the CLI,
    // so the underlying session is dead — drop it from the map so the next
    // turn respawns a fresh `claude --resume <sessionToken>` (preserves
    // transcript context). For the SDK driver, `interrupt()` is honored
    // in-band without killing the worker, so reuse is still valid.
    if (active.provider === "claude" && this.resolveClaudeDriverPreference() === "pty") {
      const session = this.claudeSessions.get(chatId)
      if (session) {
        this.closeClaudeSession(chatId, session)
      }
    }

    // Drain the queue. A queued message must auto-start after cancel; the
    // result-success branch in runClaudeSession is the only other place this
    // is called, and it can never fire for a cancelled turn (active has been
    // deleted above before the result event arrives).
    //
    // `skipQueueDrain` is passed by callers that handle dequeue themselves
    // (e.g. `steer`, which dequeues the head message with the steer wrapper).
    if (!options?.skipQueueDrain) {
      await this.maybeStartNextQueuedMessage(chatId)
    }
  }

  async respondTool(command: Extract<ClientCommand, { type: "chat.respondTool" }>) {
    const active = this.activeTurns.get(command.chatId)
    if (!active || !active.pendingTool) {
      throw new Error("No pending tool request")
    }

    const pending = active.pendingTool
    if (pending.toolUseId !== command.toolUseId) {
      throw new Error("Tool response does not match active request")
    }

    await this.store.appendMessage(
      command.chatId,
      timestamped({
        kind: "tool_result",
        toolId: command.toolUseId,
        content: normalizeToolContent(command.result),
      })
    )

    active.pendingTool = null
    active.status = "running"
    active.waitStartedAt = null

    if (pending.tool.toolKind === "exit_plan_mode") {
      const resultRec: Record<string, unknown> = isRecord(command.result) ? command.result : {}
      const confirmed = Boolean(resultRec.confirmed)
      const clearContext = Boolean(resultRec.clearContext)
      const message = typeof resultRec.message === "string" ? resultRec.message : ""
      if (confirmed && clearContext) {
        await this.store.setSessionTokenForProvider(command.chatId, active.provider, null)
        await this.store.appendMessage(command.chatId, timestamped({ kind: "context_cleared" }))
      }

      if (active.provider === "codex") {
        active.postToolFollowUp = confirmed
          ? {
              content: message
                ? `Proceed with the approved plan. Additional guidance: ${message}`
                : "Proceed with the approved plan.",
              planMode: false,
            }
          : {
              content: message
                ? `Revise the plan using this feedback: ${message}`
                : "Revise the plan using this feedback.",
              planMode: true,
            }
      }
    }

    pending.resolve(command.result)

    this.emitStateChange(command.chatId)
  }

  async respondSubagentTool(command: Extract<ClientCommand, { type: "chat.respondSubagentTool" }>) {
    const key = this.subagentPendingKey(command.chatId, command.runId, command.toolUseId)
    const resolver = this.subagentPendingResolvers.get(key)
    if (!resolver) {
      // Idempotent: a double-submit (client retry, concurrent WS messages, or
      // a response arriving after the run already terminated) should not
      // surface a confusing error to the UI. Resolver-absent = already
      // resolved or run died; nothing to do.
      return
    }
    this.subagentPendingResolvers.delete(key)
    await this.store.appendSubagentEvent({
      v: 3,
      type: "subagent_tool_resolved",
      timestamp: Date.now(),
      chatId: command.chatId,
      runId: command.runId,
      toolUseId: command.toolUseId,
      result: command.result,
      resolution: "user",
    })
    this.subagentOrchestrator.notifySubagentToolResolved(command.runId)
    resolver.resolve(command.result)
    this.emitStateChange(command.chatId)
  }

  async cancelSubagentRun(
    command: Extract<ClientCommand, { type: "chat.cancelSubagentRun" }>,
  ) {
    this.subagentOrchestrator.cancelRun(command.chatId, command.runId)
  }
}
