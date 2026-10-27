import { type ChatTaskStorePort, type SetupLoopHandlerResult } from "./kanna-mcp"
import { buildSeedTaskEvents } from "../shared/chat-tasks/seed"
import type { ChatTaskProjection } from "../shared/chat-tasks/read-model"
import { readDoc } from "./structured-doc-io.adapter"
import { PendingToolSlots } from "./pending-tool-slot"
import type { LoopSetupInput } from "./loop-template"
import type {
  AgentProvider,
  ChatAttachment,
  ChatBackgroundTask,
  LlmProviderSnapshot,
  McpOAuthState,
  PendingToolSnapshot,
  QueuedChatMessage,
  Subagent,
} from "../shared/types"
import type { ClientCommand } from "../shared/protocol"
import { EventStore, type TurnOutcome } from "./event-store"
import type { AnalyticsReporter } from "./analytics"
import { NoopAnalyticsReporter } from "./analytics"
import { CodexAppServerManager } from "./codex-app-server"
import { type GenerateChatTitleResult, generateTitleForChatDetailed } from "./generate-title"
import type { HarnessTurn } from "./harness-types"
import { startClaudeSession } from "./claude-session-start"
import { DEFAULT_AGENT_RUNTIME_CONFIG } from "./agent-runtime-config"
import { readLlmProviderSnapshot } from "./llm-provider"
import type { AutoContinueEvent } from "./auto-continue/events"
import { ClaudeLimitDetector, CodexLimitDetector, type LimitDetector } from "./auto-continue/limit-detector"
import { ClaudeAuthErrorDetector } from "./auto-continue/auth-error-detector"
import type { ScheduleManager } from "./auto-continue/schedule-manager"
import type { LoopState } from "./auto-continue/read-model"
import type { TunnelGateway } from "./cloudflare-tunnel/gateway"
import { OAuthTokenPool } from "./oauth-pool/oauth-token-pool"
import { SubagentOrchestrator, type BackgroundRunOutcome } from "./subagent-orchestrator"
import {
  buildSubagentProviderRunForChat as buildSubagentProviderRunForChatFn,
  type SubagentWiringDeps,
} from "./claude-subagent-wiring"
import type { ToolCallbackService } from "./tool-callback"
import type { ChatPermissionPolicy } from "../shared/permission-policy"
import { POLICY_DEFAULT } from "../shared/permission-policy"
import {
  type ClaudeSessionConfigHelpersDeps,
  getEnabledCustomMcpServers as getEnabledCustomMcpServersFn,
  buildOAuthBearers as buildOAuthBearersFn,
  resolveChatPolicy as resolveChatPolicyFn,
} from "./claude-session-config-helpers"
import { toError } from "../shared/errors"
import type { JsonValue } from "../shared/json"
import {
  buildBackgroundTaskWakePrompt,
  buildBackgroundTasksAbandonedMessage,
} from "./claude-prompt-helpers"
import { appendTurnError } from "./claude-turn-outcome"
import { log } from "../shared/log"
import {
  type SendMessageOptions,
  type SendToStartingProfile,
} from "./claude-steer-log"
import type { ActiveTurn, ClaudeSessionState, StartingTurn } from "./claude-session-state"
import { runClaudeSession as runClaudeSessionLoop, type RunClaudeSessionDeps } from "./claude-session-runner"
import {
  startTurnForChat as startTurnForChatFn,
  type StartTurnDeps,
} from "./claude-turn-starter"
import { runTurn as runTurnFn, type RunTurnDeps } from "./claude-turn-runner"
import { spawnClaudeTurn, type SpawnClaudeTurnArgs, type SpawnClaudeTurnDeps } from "./claude-session-spawner"
import type { CompactionEvent } from "./claude-session-start"
import { buildCompactSummaryEntry, recordCompactionStarted } from "./compaction"
import {
  resolveClaudeIdleMs as resolveClaudeIdleMsFn,
  hasLiveWorkflow as hasLiveWorkflowFn,
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
  deliverSubagentToMain as deliverSubagentToMainFn,
  setupLoop as setupLoopFn,
  isLoopArmed as isLoopArmedFn,
  stopLoop as stopLoopFn,
  listLiveSchedules as listLiveSchedulesFn,
  toArmedLoopInfo,
  type LoopCommandDeps,
} from "./claude-loop-commands"
import { handleFailedLoopTurn, recoverArmedLoopWakes as recoverArmedLoopWakesFn, resumeLoop as resumeLoopFn, type ResumeLoopResult } from "./loop-wake-recovery"
import {
  runCronCommand as runCronCommandFn,
  disarmCronJobsForChat as disarmCronJobsForChatFn,
  type CronCommandDeps,
} from "./cron/commands"
import { parseCronCommand } from "../shared/cron/parse-command"
import {
  fireCronJob as fireCronJobFn,
  recordCronTurnOutcome as recordCronTurnOutcomeFn,
  reconcileCronRunsAtBoot as reconcileCronRunsAtBootFn,
  type CronFireDeps,
} from "./cron/fire"
import { CronSkipCoalescer } from "./cron/skip-coalescer"
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
  deliverPrompt as deliverPromptFn,
  dequeueAndStartQueuedMessage as dequeueAndStartQueuedMessageFn,
  maybeStartNextQueuedMessage as maybeStartNextQueuedMessageFn,
  type SendCommandDeps,
} from "./claude-send-command"
import { clearChatContext as clearChatContextFn, type ClearChatContextDeps } from "./claude-context-commands"
import {
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
  getClaudeSessionStates as getClaudeSessionStatesFn,
  getBackgroundTasksByChatId as getBackgroundTasksByChatIdFn,
  sweepIdleClaudeSessions as sweepIdleClaudeSessionsFn,
  isAnyChatBusy,
  isChatBusy,
  type SessionStateQueryDeps,
} from "./claude-session-state-queries"
import { ensureFreshMcpToken } from "./mcp-oauth.adapter"
import { realpathAdapter } from "./paths-fs.adapter"
import {
  isWorktreeOfSameRepo,
  readOracleScript,
} from "./loop-template-io.adapter"
import { currentBranchName, mergeLoopBranch } from "./loop-integrate-io.adapter"
import { runVerifyCommand } from "./loop-verify-io.adapter"
import { homedir } from "node:os"
import { isClaudeSdkProvider } from "./provider-catalog"
import { createMermaidGuard } from "./mermaid-guard"
import { composeTurnEndGuards, type TurnEndGuard } from "./turn-end-guard"
import { createGenUIGuard } from "./genui/genui-guard"
import { isGenUIEnabled } from "./genui/genui-config"
import type { DatasetDecl } from "../shared/genui"
import { createCronRepair, type CronRepair } from "./cron/repair"
import { createCronConfirm, type CronConfirm } from "./cron/confirm"
import { createModelEscalation, type ModelEscalation } from "./model-escalation"
import { parseMermaid } from "./mermaid-parse.adapter"
import { repairMermaidSource } from "../shared/mermaidRepair"
import { resolveChatCwd } from "./claude-session-config"
import { createLocalSkillAccess, type LocalSkillAccess } from "./skill-invocation"
import { readCatalogFileBody } from "./local-catalog-io.adapter"
import {
  addCounter,
  recordHistogram,
  TURN_COST_USD,
  TURN_DURATION_MS,
  TURN_TOKENS,
} from "./observability"
import { splitBilledTokens } from "../shared/token-pricing"
import type {
  AgentCoordinatorArgs,
  ClaudeSessionLifecycleOptions,
} from "./agent-coordinator-types"

function recordTurnSpend(active: ActiveTurn): void {
  const usage = active.usage
  if (!usage) return
  const attributes = { provider: active.provider, model: active.model }
  for (const [kind, count] of splitBilledTokens(usage)) {
    addCounter(TURN_TOKENS, count, { ...attributes, kind })
  }
  const cost = usage.costUsd
  if (cost !== undefined && Number.isFinite(cost) && cost >= 0) {
    addCounter(TURN_COST_USD, cost, attributes)
  }
}

export class AgentCoordinator {
  readonly store: EventStore
  private readonly onStateChange: (chatId?: string, options?: { immediate?: boolean }) => void
  readonly analytics: AnalyticsReporter
  readonly codexManager: CodexAppServerManager
  readonly generateTitle: (messageContent: string, cwd: string) => Promise<GenerateChatTitleResult>
  readonly startClaudeSessionFn: NonNullable<AgentCoordinatorArgs["startClaudeSession"]>
  reportBackgroundError: ((message: string) => void) | null = null
  private readonly activeTurns = new Map<string, ActiveTurn>()
  private readonly pendingTools = new PendingToolSlots()
  private readonly startingTurns = new Map<string, StartingTurn>()
  private readonly drainingStreams = new Map<string, { turn: HarnessTurn }>()
  private readonly claudeSessions = new Map<string, ClaudeSessionState>()
  readonly mentionedSubagentIdsByChat = new Map<string, string[]>()
  readonly claudeLimitDetector: LimitDetector
  readonly codexLimitDetector: LimitDetector
  readonly claudeAuthErrorDetector: ClaudeAuthErrorDetector
  readonly scheduleManager: ScheduleManager | null
  readonly cronScheduler: import("./cron/scheduler").CronScheduler | null
  readonly cronSkipCoalescer = new CronSkipCoalescer()
  private readonly pendingCronOutcomes = new Set<Promise<void>>()
  private readonly unsubscribeTurnTerminal: () => void
  private readonly _cronRepair: CronRepair
  private readonly _cronConfirm: CronConfirm
  private readonly _turnEndGuard: TurnEndGuard
  private readonly _codexTurnEndGuard: TurnEndGuard
  readonly getAutoResumePreference: () => boolean
  readonly getSubagents: () => Subagent[]
  readonly getAppSettingsSnapshot: NonNullable<AgentCoordinatorArgs["getAppSettingsSnapshot"]>
  private readonly subagentOrchestrator: SubagentOrchestrator
  getSubagentOrchestrator(): SubagentOrchestrator {
    return this.subagentOrchestrator
  }
  hasAnyChatBusy(): boolean {
    return isAnyChatBusy(this.sessionStateQueryDeps())
  }
  readonly autoResumeByChat = new Map<string, boolean>()
  readonly endpointFirstEntryTimeoutMs: number
  readonly tokenRotationDedupe = new Map<string, TokenRotationDedupeEntry>()
  readonly tunnelGateway: TunnelGateway | null
  readonly oauthPool: OAuthTokenPool | null
  readonly toolCallback: ToolCallbackService | null
  readonly chatPolicy: ChatPermissionPolicy
  readonly claudeSessionLifecycle: ClaudeSessionLifecycleOptions
  private readonly claudeSessionSweepTimer: ReturnType<typeof setInterval> | null
  readonly workflowRegistry: import("./workflow-registry").WorkflowRegistry | null
  readonly boardRegistry: import("./board-registry").BoardRegistry | null
  readonly inboxRegistry: import("./inbox/inbox-registry").InboxRegistry | null
  readonly beaconRegistry: import("./beacon-registry").BeaconRegistry | null
  readonly getBeacons: () => readonly import("../shared/beacon-config").BeaconConfig[]
  readonly backgroundTaskOutputRegistry: import("./background-task-output-registry").BackgroundTaskOutputRegistry | null
  readonly liveBlocks: import("./live-block-throttle").LiveBlockHub | null
  readonly subagentTranscriptRegistry: import("./subagent-transcript-registry").SubagentTranscriptRegistry | null
  readonly localCatalog: import("./local-catalog").LocalCatalogService | null
  private readonly skillAccess: LocalSkillAccess
  private readonly sessionConfig: ClaudeSessionConfigHelpersDeps
  private readonly sessionLifecycle: SessionLifecycleDeps
  readonly readLlmProvider: () => Promise<LlmProviderSnapshot>
  readonly getCustomProviderCredential: (id: string) => import("../shared/custom-providers").CustomProviderCredential | null
  readonly listOpenRouterModelsFn: (() => Promise<import("../shared/types").OpenRouterModel[]>) | null
  readonly persistOAuthStateFn: ((id: string, oauth: McpOAuthState) => void) | null
  readonly subagentPendingResolvers = new Map<
    string,
    { resolve: (v: JsonValue) => void; reject: (e: Error) => void }
  >()

  constructor(args: AgentCoordinatorArgs) {
    this.store = args.store
    this.onStateChange = args.onStateChange
    this.analytics = args.analytics ?? NoopAnalyticsReporter
    this.codexManager = args.codexManager ?? new CodexAppServerManager()
    this.generateTitle = args.generateTitle ?? generateTitleForChatDetailed
    this.startClaudeSessionFn = args.startClaudeSession ?? startClaudeSession
    this.claudeLimitDetector = args.claudeLimitDetector ?? new ClaudeLimitDetector()
    this.codexLimitDetector = args.codexLimitDetector ?? new CodexLimitDetector()
    this.claudeAuthErrorDetector = new ClaudeAuthErrorDetector()
    this.scheduleManager = args.scheduleManager ?? null
    const config = args.runtimeConfig ?? DEFAULT_AGENT_RUNTIME_CONFIG
    this.cronScheduler = args.cronScheduler ?? null
    this._cronRepair = createCronRepair({
      escalation: this._buildModelEscalation({
        name: "cron/repair",
        enabled: config.cronRepairEnabled,
        drain: true,
      }),
    })
    this._cronConfirm = createCronConfirm({
      escalation: this._buildModelEscalation({
        name: "cron/confirm",
        enabled: config.cronConfirmEnabled,
        drain: true,
      }),
    })
    const genuiDatasets = args.genuiDatasets
    const checkGenUIDataset = async (chatId: string, decl: DatasetDecl) =>
      (genuiDatasets ? await genuiDatasets.checkResolvable(chatId, decl) : null)
    const genuiEscalation = this._buildModelEscalation({ name: "genui", enabled: isGenUIEnabled() })
    this._codexTurnEndGuard = createGenUIGuard(genuiEscalation, checkGenUIDataset, false)
    this._turnEndGuard = composeTurnEndGuards(
      createMermaidGuard({
        escalation: this._buildModelEscalation({
          name: "mermaid",
          enabled: config.mermaidGuardEnabled,
        }),
        parse: parseMermaid,
        repair: (source) => {
          const result = repairMermaidSource(source)
          return { source: result.source, repaired: result.repairs.length > 0 }
        },
      }),
      createGenUIGuard(genuiEscalation, checkGenUIDataset, true),
    )
    const onTurnOutcome = args.onTurnOutcome
    this.unsubscribeTurnTerminal = this.store.subscribeTurnTerminal((chatId, outcome) => {
      this.handleTurnTerminal(chatId, outcome, onTurnOutcome)
    })
    this.getAutoResumePreference = args.getAutoResumePreference ?? (() => false)
    this.endpointFirstEntryTimeoutMs = config.endpointFirstEntryTimeoutMs
    this.getSubagents = args.getSubagents ?? (() => [])
    this.getAppSettingsSnapshot = args.getAppSettingsSnapshot ?? (() => ({}))
    this.readLlmProvider = args.readLlmProvider ?? readLlmProviderSnapshot
    this.getCustomProviderCredential = args.getCustomProviderCredential ?? (() => null)
    this.listOpenRouterModelsFn = args.listOpenRouterModels ?? null
    this.persistOAuthStateFn = args.persistOAuthState ?? null
    this.subagentOrchestrator = new SubagentOrchestrator({
      store: this.store,
      appSettings: { getSnapshot: () => ({ subagents: this.getSubagents() }) },
      startProviderRun: (a) => buildSubagentProviderRunForChatFn(this.subagentWiringDeps(), {
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
        this.emitStateChange(chatId)
      },
      onRunProgress: (chatId) => {
        this.emitStateChange(chatId)
      },
      onBackgroundRunComplete: (chatId, runId, outcome) => {
        void this.deliverSubagentToMain(chatId, runId, outcome)
      },
      maxLive: config.subagentMaxLive,
      liveIdleTimeoutMs: config.subagentIdleTimeoutMs,
      runTimeoutMs: (this.getAppSettingsSnapshot().subagentRuntime?.runTimeoutMs
        ?? config.subagentRunTimeoutMs)
        || undefined,
    })
    this.tunnelGateway = args.tunnelGateway ?? null
    this.oauthPool = args.oauthPool ?? null
    this.toolCallback = args.toolCallback ?? null
    this.chatPolicy = args.chatPolicy ?? POLICY_DEFAULT
    this.claudeSessionLifecycle = {
      idleMs: args.claudeSessionLifecycle?.idleMs ?? config.claudeSessionLifecycle.idleMs,
      maxResidentSessions: args.claudeSessionLifecycle?.maxResidentSessions
        ?? config.claudeSessionLifecycle.maxResidentSessions,
      sweepIntervalMs: args.claudeSessionLifecycle?.sweepIntervalMs
        ?? config.claudeSessionLifecycle.sweepIntervalMs,
      backgroundTaskMaxMs: args.claudeSessionLifecycle?.backgroundTaskMaxMs
        ?? config.claudeSessionLifecycle.backgroundTaskMaxMs,
      backgroundTaskMaxWakes: args.claudeSessionLifecycle?.backgroundTaskMaxWakes
        ?? config.claudeSessionLifecycle.backgroundTaskMaxWakes,
    }
    this.claudeSessionSweepTimer = this.claudeSessionLifecycle.sweepIntervalMs > 0
      ? setInterval(() => { this.sweepIdleClaudeSessions() }, this.claudeSessionLifecycle.sweepIntervalMs)
      : null
    this.claudeSessionSweepTimer?.unref?.()
    this.workflowRegistry = args.workflowRegistry ?? null
    this.boardRegistry = args.boardRegistry ?? null
    this.inboxRegistry = args.inboxRegistry ?? null
    this.beaconRegistry = args.beaconRegistry ?? null
    this.getBeacons = args.getBeacons ?? (() => [])
    this.backgroundTaskOutputRegistry = args.backgroundTaskOutputRegistry ?? null
    this.liveBlocks = args.liveBlocks ?? null
    this.subagentTranscriptRegistry = args.subagentTranscriptRegistry ?? null
    this.localCatalog = args.localCatalog ?? null
    this.skillAccess = createLocalSkillAccess(this.localCatalog, (id) => resolveChatCwd(this.store, id), readCatalogFileBody)
    this.sessionConfig = {
      getAppSettingsSnapshot: () => this.getAppSettingsSnapshot(),
      chatPolicy: this.chatPolicy,
      store: this.store,
      ensureFreshToken: (server, opts) => ensureFreshMcpToken(server, opts),
      persistOAuthState: this.persistOAuthStateFn,
    }
    this.sessionLifecycle = {
      getAppSettingsSnapshot: () => this.getAppSettingsSnapshot(),
      defaultIdleMs: this.claudeSessionLifecycle.idleMs,
      defaultMaxResidentSessions: this.claudeSessionLifecycle.maxResidentSessions,
      claudeSessions: this.claudeSessions,
      activeTurns: this.activeTurns,
      startingTurns: this.startingTurns,
      pendingTools: this.pendingTools,
      oauthPool: this.oauthPool,
      workflowRegistry: this.workflowRegistry,
      emitStateChange: (chatId: string) => { this.emitStateChange(chatId) },
      store: this.store,
      homeDir: homedir(),
    }
  }

  private _buildModelEscalation(opts: { name: string; enabled: boolean; drain?: boolean }): ModelEscalation {
    return createModelEscalation({
      name: opts.name,
      enabled: opts.enabled,
      hasQueuedMessage: (chatId) => this.store.getQueuedMessages(chatId).length > 0,
      enqueueMessage: async (chatId, content, options) => {
        await this.enqueueMessage(chatId, content, [], options)
      },
      drainQueue: opts.drain
        ? async (chatId) => {
            await this.maybeStartNextQueuedMessage(chatId)
          }
        : undefined,
    })
  }

  getActiveTurnChatIds(): string[] {
    return [...this.activeTurns.keys()]
  }


  getClaudeSessionMap(): Map<string, ClaudeSessionState> { return this.claudeSessions }
  getActiveTurnMap(): Map<string, ActiveTurn> { return this.activeTurns }
  getPendingToolSlots(): PendingToolSlots { return this.pendingTools }

  setBackgroundErrorReporter(report: ((message: string) => void) | null) {
    this.reportBackgroundError = report
  }

  private handleTurnTerminal(
    chatId: string,
    outcome: TurnOutcome,
    onTurnOutcome: AgentCoordinatorArgs["onTurnOutcome"],
  ): void {
    onTurnOutcome?.(chatId, outcome)
    const active = this.activeTurns.get(chatId)
    if (active) {
      recordHistogram(TURN_DURATION_MS, Date.now() - active.startedAt, {
        provider: active.provider,
        model: active.model,
        outcome,
      })
      recordTurnSpend(active)
    }
    if (outcome === "failed") void handleFailedLoopTurn(this.loopCommandDeps(), chatId)
    const tag = active?.cronRun
    if (!tag) return
    const p = recordCronTurnOutcomeFn(this.cronCommandDeps(), tag, outcome).catch((error) => {
      log.error("[kanna/cron] failed to record run outcome:", String(error))
    })
    this.pendingCronOutcomes.add(p)
    p.finally(() => this.pendingCronOutcomes.delete(p))
  }

  async dispose(gracefulTimeoutMs = 20_000): Promise<void> {
    this.unsubscribeTurnTerminal()
    if (this.claudeSessionSweepTimer) clearInterval(this.claudeSessionSweepTimer)
    const closedPromises = [...this.claudeSessions.entries()].map(([chatId, session]) => {
      const closed = session.session.closed
      this.closeClaudeSession(chatId, session)
      return closed
    })
    if (closedPromises.length === 0) return
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, gracefulTimeoutMs))
    await Promise.race([Promise.allSettled(closedPromises), timeout])
  }

  getActiveStatuses() {
    return getActiveStatusesFn(this.sessionStateQueryDeps())
  }

  hasActiveTurn(chatId: string): boolean {
    return this.activeTurns.has(chatId)
  }

  getWaitStartedAtByChatId(): Map<string, number> {
    return getWaitStartedAtByChatIdFn(this.sessionStateQueryDeps())
  }

  getPendingTool(chatId: string): PendingToolSnapshot | null {
    return getPendingToolFn(this.sessionStateQueryDeps(), chatId)
  }

  getDrainingChatIds(): Set<string> {
    return getDrainingChatIdsFn(this.sessionStateQueryDeps())
  }

  getClaudeSessionStates(): Map<string, "warming" | "active" | "idle"> {
    return getClaudeSessionStatesFn(this.sessionStateQueryDeps())
  }

  getBackgroundTasksByChatId(): Map<string, ChatBackgroundTask[]> {
    return getBackgroundTasksByChatIdFn(this.sessionStateQueryDeps())
  }

  get toolCallbackService(): ToolCallbackService | null {
    return this.toolCallback
  }

  emitStateChange(chatId?: string, options?: { immediate?: boolean }) {
    this.onStateChange(chatId, options)
  }


  resolveChatPolicy(chatId: string): ChatPermissionPolicy {
    return resolveChatPolicyFn(this.sessionConfig, chatId)
  }


  private sessionErrorHandlerDeps(): SessionErrorHandlerDeps {
    return {
      tokenRotationDedupe: this.tokenRotationDedupe,
      claudeSessions: this.claudeSessions,
      activeTurns: this.activeTurns,
      oauthPool: this.oauthPool,
      store: this.store,
      resolveAutoResumeFor: (chatId: string) => resolveAutoResumeForFn(this.autoContinueDeps(), chatId),
      emitAutoContinueEvent: (event) => this.emitAutoContinueEvent(event),
      closeClaudeSession: (chatId, session, opts?) =>
        this.closeClaudeSession(chatId, session, opts),
    }
  }


  private autoContinueDeps(): AutoContinueCommandDeps {
    return {
      autoResumeByChat: this.autoResumeByChat,
      getAutoResumePreference: () => this.getAutoResumePreference(),
      store: this.store,
      scheduleManager: this.scheduleManager,
      emitStateChange: (chatId: string) => { this.emitStateChange(chatId) },
      deliverPrompt: (chatId, content, attachments, options) =>
        this.deliverPrompt(chatId, content, attachments, options),
    }
  }

  private projectChatTasks(chatId: string): ChatTaskProjection {
    return this.store.getChatTasks(chatId, { now: Date.now() })
  }

  private loopCommandDeps(): LoopCommandDeps {
    return {
      store: this.store,
      claudeSessions: this.claudeSessions,
      activeTurns: this.activeTurns,
      startingTurns: this.startingTurns,
      pendingTools: this.pendingTools,
      hasLiveWorkflow: (chatId) => hasLiveWorkflowFn(this.sessionLifecycle, chatId),
      getSubagents: () => this.getSubagents(),
      getAppSettingsSnapshot: () => this.getAppSettingsSnapshot(),
      closeClaudeSession: (chatId, session) => this.closeClaudeSession(chatId, session),
      emitAutoContinueEvent: (event) => this.emitAutoContinueEvent(event),
      isWorktreeOfSameRepo,
      currentBranchName,
      runVerifyCommand,
      readOracleScript,
      isLoopArmed: (chatId) => this.isLoopArmed(chatId),
      isChatBusy: (chatId) => isChatBusy(this.sendCommandDeps(), chatId),
      getChatTasks: (chatId) => this.projectChatTasks(chatId).tasks,
      getChatTaskProjection: (chatId) => this.projectChatTasks(chatId),
      seedChatTasks: async (chatId, tasks, failedApproaches) => {
        await this.store.appendChatTaskEvents(buildSeedTaskEvents({
          chatId,
          now: Date.now(),
          tasks,
          failedApproaches,
          newId: () => crypto.randomUUID().slice(0, 8),
        }))
        this.emitStateChange(chatId)
      },
      readTrackingFileForImport: (absPath) => readDoc(absPath),
    }
  }

  private cronCommandDeps(): CronCommandDeps {
    return {
      store: this.store,
      cronScheduler: this.cronScheduler,
      skipCoalescer: this.cronSkipCoalescer,
      emitStateChange: (chatId) => this.emitStateChange(chatId),
      pushCronJobsUpdate: () => this.onCronJobsChange?.(),
      cronRepair: this._cronRepair,
      cronConfirm: this._cronConfirm,
      resolveChatCwd: (chatId) => resolveChatCwd(this.store, chatId),
    }
  }

  private cronFireDeps(): CronFireDeps {
    return {
      ...this.cronCommandDeps(),
      skipCoalescer: this.cronSkipCoalescer,
      getChatRecord: (chatId) => this.store.getChat(chatId),
      isChatBusy: (chatId) => isChatBusy(this.sendCommandDeps(), chatId),
      holdsBackgroundWork: (chatId) => {
        const session = this.claudeSessions.get(chatId)
        return Object.values(this.store.getSubagentRuns(chatId)).some((run) => run.status === "running")
          || hasLiveWorkflowFn(this.sessionLifecycle, chatId)
          || (session?.isHoldingWork(Date.now()) === true)
      },
      clearChatContext: (chatId) => this.clearChatContext(chatId),
      createChat: (projectId) => this.store.createChat(projectId),
      enqueueMessage: (chatId, content, attachments, options) =>
        this.enqueueMessage(chatId, content, attachments, options),
      maybeStartNextQueuedMessage: async (chatId) => this.maybeStartNextQueuedMessage(chatId),
      onChatSpawned: this.boardRegistry
        ? (originChatId, spawnedChatId) => {
            const registry = this.boardRegistry!
            for (const card of registry.findCardsByLink("chat", originChatId)) {
              registry.addCardLink(card.id, "chat", spawnedChatId)
            }
          }
        : undefined,
    }
  }


  private cancelHandlerDeps(): CancelHandlerDeps {
    return {
      drainingStreams: this.drainingStreams,
      rejectPendingResolversForChat: (chatId) => this.rejectPendingResolversForChat(chatId),
      cancelChatInOrchestrator: (chatId) => this.getSubagentOrchestrator().cancelChat(chatId),
      activeTurns: this.activeTurns,
      pendingTools: this.pendingTools,
      startingTurns: this.startingTurns,
      store: this.store,
      claudeSessions: this.claudeSessions,
      emitStateChange: (chatId) => this.emitStateChange(chatId),
    }
  }


  private chatManagementDeps(): ChatManagementDeps {
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


  private sendCommandDeps(): SendCommandDeps {
    return {
      store: this.store,
      activeTurns: this.activeTurns,
      startingTurns: this.startingTurns,
      pendingTools: this.pendingTools,
      claudeSessions: this.claudeSessions,
      resolveBackgroundTaskMaxMs: () => this.resolveBackgroundTaskMaxMs(),
      autoResumeByChat: this.autoResumeByChat,
      analytics: this.analytics,
      getAppSettingsSnapshot: () => this.getAppSettingsSnapshot(),
      stopLoop: (chatId, reason) => this.stopLoop(chatId, reason),
      emitStateChange: (chatId) => this.emitStateChange(chatId),
      startTurnForChat: (args) => this.startTurnForChat(args),
      clearChatContext: (chatId) => this.clearChatContext(chatId),
      runCronCommand: (chatId, result, model) => this.runCronCommand(chatId, result, model),
      expandSlashCommand: (chatId, content) => this.skillAccess.expandSlashCommand(chatId, content),
    }
  }


  private subagentWiringDeps(): SubagentWiringDeps {
    return {
      store: this.store,
      startClaudeSessionFn: this.startClaudeSessionFn,
      subagentOrchestrator: this.getSubagentOrchestrator(),
      codexManager: this.codexManager,
      oauthPool: this.oauthPool,
      subagentPendingResolvers: this.subagentPendingResolvers,
      realpath: realpathAdapter,
      getEnabledCustomMcpServers: () => getEnabledCustomMcpServersFn(this.sessionConfig),
      buildOAuthBearers: (servers) => buildOAuthBearersFn(this.sessionConfig, servers),
      resolveChatPolicy: (chatId) => this.resolveChatPolicy(chatId),
      emitStateChange: (chatId) => { this.emitStateChange(chatId) },
      buildPoolUnavailableMessage: (reservedFor, scopeSuffix) =>
        buildPoolUnavailableMessageFn(this.sessionLifecycle, reservedFor, scopeSuffix),
      getAppSettingsSnapshot: () => this.getAppSettingsSnapshot(),
      readLlmProvider: () => this.readLlmProvider(),
      getCustomProviderCredential: (id) => this.getCustomProviderCredential(id),
      getArmedLoop: (chatId) => toArmedLoopInfo(this.isLoopArmed(chatId)),
      beaconRegistry: this.beaconRegistry ?? undefined,
      getBeacons: this.getBeacons,
      toolCallback: this.toolCallback,
    }
  }



  resolveBackgroundTaskMaxMs(): number {
    return this.claudeSessionLifecycle.backgroundTaskMaxMs
  }

  resolveBackgroundTaskMaxWakes(): number {
    return this.claudeSessionLifecycle.backgroundTaskMaxWakes
  }

  wakeBackgroundTaskSession(
    chatId: string,
    taskIds: string[],
    wakeNumber: number,
    maxWakes: number,
  ): void {
    const prompt = buildBackgroundTaskWakePrompt(taskIds, wakeNumber, maxWakes)
    log.info("[kanna/agent] background-task watchdog wake", { chatId, taskIds, wakeNumber, maxWakes })
    void this.deliverPrompt(chatId, prompt, [], {
      autoContinue: { scheduleId: `bg-task-wake-${wakeNumber}` },
    })
      .catch((error) => {
        const message = toError(error).message
        log.error("[kanna/agent] background-task watchdog wake failed", { chatId, message })
        this.reportBackgroundError?.(`Background-task watchdog wake failed for chat ${chatId}: ${message}`)
      })
  }

  notifyBackgroundTasksAbandoned(chatId: string, taskIds: string[]): void {
    log.warn("[kanna/agent] background task(s) abandoned at session close", { chatId, taskIds })
    void appendTurnError(this.store, chatId, buildBackgroundTasksAbandonedMessage(taskIds))
      .then(() => { this.emitStateChange(chatId) })
      .catch((error) => {
        const message = toError(error).message
        log.error("[kanna/agent] background-task abandonment notice failed", { chatId, message })
      })
  }

  closeClaudeSession(
    chatId: string,
    session: ClaudeSessionState,
    opts?: { keepReservation?: boolean },
  ): void {
    closeClaudeSessionFn(this.sessionLifecycle, chatId, session, opts)
  }


  enforceClaudeSessionBudget(protectedChatId?: string): void {
    enforceClaudeSessionBudgetFn(this.sessionLifecycle, protectedChatId)
  }

  private sweepIdleClaudeSessions(now = Date.now()): void {
    sweepIdleClaudeSessionsFn(this.sessionStateQueryDeps(), now)
  }



  private subagentToolResponseDeps(): SubagentToolResponseDeps {
    return {
      subagentPendingResolvers: this.subagentPendingResolvers,
      store: this.store,
      subagentOrchestrator: this.getSubagentOrchestrator(),
      emitStateChange: (chatId) => { this.emitStateChange(chatId) },
    }
  }

  private toolRespondDeps(): ToolRespondDeps {
    return {
      activeTurns: this.activeTurns,
      pendingTools: this.pendingTools,
      store: this.store,
      emitStateChange: (chatId) => { this.emitStateChange(chatId) },
    }
  }

  private sessionStateQueryDeps(): SessionStateQueryDeps {
    return {
      activeTurns: this.activeTurns,
      startingTurns: this.startingTurns,
      pendingTools: this.pendingTools,
      claudeSessions: this.claudeSessions,
      drainingStreams: this.drainingStreams,
      isClaudeSdkProvider: (provider) => isClaudeSdkProvider(provider),
      resolveClaudeIdleMs: () => resolveClaudeIdleMsFn(this.sessionLifecycle),
      resolveBackgroundTaskMaxMs: () => this.resolveBackgroundTaskMaxMs(),
      resolveBackgroundTaskMaxWakes: () => this.resolveBackgroundTaskMaxWakes(),
      hasLiveWorkflow: (chatId) => hasLiveWorkflowFn(this.sessionLifecycle, chatId),
      closeClaudeSession: (chatId, session) => { this.closeClaudeSession(chatId, session) },
      emitStateChange: (chatId) => { this.emitStateChange(chatId) },
      wakeBackgroundTaskSession: (chatId, taskIds, wakeNumber, maxWakes) => {
        this.wakeBackgroundTaskSession(chatId, taskIds, wakeNumber, maxWakes)
      },
      notifyBackgroundTasksAbandoned: (chatId, taskIds) => {
        this.notifyBackgroundTasksAbandoned(chatId, taskIds)
      },
    }
  }

  rejectPendingResolversForChat(chatId: string): void {
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

  clearDrainingStream(chatId: string): void {
    this.drainingStreams.delete(chatId)
  }

  async stopDraining(chatId: string) {
    return stopDrainingFn(this.chatManagementDeps(), chatId)
  }

  async closeChat(chatId: string) {
    return closeChatFn(this.chatManagementDeps(), chatId)
  }

  async enqueueMessage(chatId: string, content: string, attachments: ChatAttachment[], options?: SendMessageOptions) {
    return enqueueMessageFn(this.sendCommandDeps(), chatId, content, attachments, options)
  }

  async deliverPrompt(chatId: string, content: string, attachments: ChatAttachment[], options?: SendMessageOptions) {
    return deliverPromptFn(this.sendCommandDeps(), chatId, content, attachments, options)
  }

  async dequeueAndStartQueuedMessage(chatId: string, queuedMessage: QueuedChatMessage, options?: { steered?: boolean }) {
    return dequeueAndStartQueuedMessageFn(this.sendCommandDeps(), chatId, queuedMessage, options)
  }

  async maybeStartNextQueuedMessage(chatId: string, options?: { replay?: boolean }) {
    return maybeStartNextQueuedMessageFn(this.sendCommandDeps(), chatId, options)
  }

  async clearChatContext(chatId: string) {
    return clearChatContextFn(this.clearChatContextDeps(), chatId)
  }

  private clearChatContextDeps(): ClearChatContextDeps {
    return {
      store: this.store,
      claudeSessions: this.claudeSessions,
      activeTurns: this.activeTurns,
      startingTurns: this.startingTurns,
      pendingTools: this.pendingTools,
      hasLiveWorkflow: (chatId) => hasLiveWorkflowFn(this.sessionLifecycle, chatId),
      closeClaudeSession: (chatId, session) => this.closeClaudeSession(chatId, session),
      stopCodexSession: (chatId) => this.codexManager.stopSession(chatId),
      emitStateChange: (chatId) => this.emitStateChange(chatId),
    }
  }

  private startTurnDeps(): StartTurnDeps {
    return {
      activeTurns: this.activeTurns,
      startingTurns: this.startingTurns,
      claudeSessions: this.claudeSessions,
      drainingStreams: this.drainingStreams,
      mentionedSubagentIdsByChat: this.mentionedSubagentIdsByChat,
      store: this.store,
      codexManager: this.codexManager,
      subagentOrchestrator: this.getSubagentOrchestrator(),
      clearDrainingStream: (chatId) => this.clearDrainingStream(chatId),
      emitStateChange: (chatId, opts) => this.emitStateChange(chatId, opts),
      getSubagents: () => this.getSubagents(),
      getBeacons: this.getBeacons,
      isBeaconOnline: (beaconId) => this.beaconRegistry?.isOnline(beaconId) ?? false,
      getAppSettingsSnapshot: () => this.getAppSettingsSnapshot(),
      listSkills: (chatId) => this.skillAccess.listSkills(chatId),
      generateTitleInBackground: (chatId, content, localPath, optimisticTitle) =>
        generateTitleInBackgroundFn(this.chatManagementDeps(), chatId, content, localPath, optimisticTitle),
      pendingTools: this.pendingTools,
      startClaudeTurn: (args) => this.startClaudeTurn(args),
      findLastUserMessageId: (chatId) => this.findLastUserMessageId(chatId),
      runTurn: (active) => runTurnFn(this.runTurnDeps(), active),
    }
  }

  async startTurnForChat(args: {
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
    return startTurnForChatFn(this.startTurnDeps(), args)
  }

  findLastUserMessageId(chatId: string): string | null {
    return this.store.getLastUserMessageId(chatId)
  }

  private chatTaskStore(): ChatTaskStorePort {
    return {
      appendEvents: async (events) => {
        await this.store.appendChatTaskEvents(events)
        for (const chatId of new Set(events.map((event) => event.chatId))) this.emitStateChange(chatId)
      },
      project: (chatId, ctx) => this.store.getChatTasks(chatId, ctx),
      decide: async (chatId, ctx, fn) => {
        const { events, result } = await this.store.decideChatTaskEvents(chatId, ctx, fn)
        if (events.length > 0) this.emitStateChange(chatId)
        return result
      },
      mergeBranch: (workdir, branch) => mergeLoopBranch(workdir, branch),
    }
  }

  private isRunAlive(chatId: string, runId: string): boolean {
    return this.store.getSubagentRuns(chatId)[runId]?.status === "running"
  }

  private spawnClaudeTurnDeps(): SpawnClaudeTurnDeps {
    return {
      isRunAlive: (chatId, runId) => this.isRunAlive(chatId, runId),
      chatTaskStore: this.chatTaskStore(),
      claudeSessions: this.claudeSessions,
      activeTurns: this.activeTurns,
      mentionedSubagentIdsByChat: this.mentionedSubagentIdsByChat,
      oauthPool: this.oauthPool,
      startClaudeSessionFn: this.startClaudeSessionFn,
      subagentOrchestrator: this.getSubagentOrchestrator(),
      toolCallback: this.toolCallback,
      tunnelGateway: this.tunnelGateway,
      isLoopArmed: (chatId) => this.isLoopArmed(chatId),
      boardRegistry: this.boardRegistry ?? undefined,
      inboxRegistry: this.inboxRegistry ?? undefined,
      beaconRegistry: this.beaconRegistry ?? undefined,
      getBeacons: this.getBeacons,
      closeClaudeSession: (chatId, session) => this.closeClaudeSession(chatId, session),
      enforceClaudeSessionBudget: (protectedChatId?) => this.enforceClaudeSessionBudget(protectedChatId),
      readLlmProvider: () => this.readLlmProvider(),
      getCustomProviderCredential: (id) => this.getCustomProviderCredential(id),
      buildPoolUnavailableMessage: (reservedFor, scopeSuffix) =>
        buildPoolUnavailableMessageFn(this.sessionLifecycle, reservedFor, scopeSuffix),
      listOpenRouterModelsFn: this.listOpenRouterModelsFn,
      getSubagents: () => this.getSubagents(),
      getAppSettingsSnapshot: () => this.getAppSettingsSnapshot(),
      getEnabledCustomMcpServers: () => getEnabledCustomMcpServersFn(this.sessionConfig),
      buildOAuthBearers: (servers) => buildOAuthBearersFn(this.sessionConfig, servers),
      setupLoop: (chatId, input) => this.setupLoop({ chatId, input }),
      armCron: (chatId, command) => this.armCron(chatId, command),
      updateCron: (chatId, jobId, patch) => this.updateCron(chatId, jobId, patch),
      stopLoop: (chatId, reason) => this.stopLoop(chatId, reason),
      resumeLoop: (chatId) => this.resumeLoop(chatId),
      resolveChatPolicy: (chatId) => this.resolveChatPolicy(chatId),
      getCostBaselineUsd: (chatId) => this.store.getLatestClaudeCumulativeCostUsd(chatId),
      runClaudeSession: (session) => { void this.runClaudeSession(session) },
      emitStateChange: (chatId) => { this.emitStateChange(chatId) },
      onCompaction: (event) => { this.handleCompaction(event) },
    }
  }

  private handleCompaction(event: CompactionEvent): void {
    const provider = this.store.getChat(event.chatId)?.provider
    if (event.phase === "pre") {
      recordCompactionStarted(provider, event.trigger)
      return
    }
    if (event.summary === undefined) return
    const entry = buildCompactSummaryEntry({ sessionId: event.sessionId, summary: event.summary })
    if (!entry) return
    this.store
      .appendMessage(event.chatId, entry)
      .then(() => { this.emitStateChange(event.chatId) })
      .catch((error: Error) => {
        log.warn("[kanna/compaction] failed to persist the compaction summary", String(error))
      })
  }

  startClaudeTurn(args: SpawnClaudeTurnArgs): Promise<HarnessTurn> {
    return spawnClaudeTurn(this.spawnClaudeTurnDeps(), args)
  }

  async send(command: Extract<ClientCommand, { type: "chat.send" }>) {
    return sendCommandFn(this.sendCommandDeps(), command)
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
      origin: command.origin,
    })
    return { queuedMessageId: queuedMessage.id }
  }

  async steer(command: Extract<ClientCommand, { type: "message.steer" }>) {
    return steerFn(this.chatManagementDeps(), command)
  }

  async dequeue(command: Extract<ClientCommand, { type: "message.dequeue" }>) {
    return dequeueFn(this.chatManagementDeps(), command)
  }

  async forkChat(chatId: string) {
    return forkChatFn(this.chatManagementDeps(), chatId)
  }

  private runClaudeSessionDeps(): RunClaudeSessionDeps {
    return {
      endpointFirstEntryTimeoutMs: this.endpointFirstEntryTimeoutMs,
      claudeSessions: this.claudeSessions,
      activeTurns: this.activeTurns,
      pendingTools: this.pendingTools,
      oauthPool: this.oauthPool,
      claudeLimitDetector: this.claudeLimitDetector,
      claudeAuthErrorDetector: this.claudeAuthErrorDetector,
      store: this.store,
      emitStateChange: (chatId?) => { this.emitStateChange(chatId) },
      handleLimitDetection: (chatId, detection) => handleLimitDetectionFn(this.sessionErrorHandlerDeps(), chatId, detection),
      maybeRegisterSdkWorkflowsDir: (session) => { maybeRegisterSdkWorkflowsDirFn(this.sessionLifecycle, session) },
      getSubagents: () => this.getSubagents(),
      resolveBackgroundTaskMaxMs: () => this.resolveBackgroundTaskMaxMs(),
      handleAuthFailure: (session, detection) => handleAuthFailureFn(this.sessionErrorHandlerDeps(), session, detection),
      closeClaudeSession: (chatId, session) => { this.closeClaudeSession(chatId, session) },
      maybeStartNextQueuedMessage: (chatId) => this.maybeStartNextQueuedMessage(chatId),
      turnEndGuard: this._turnEndGuard,
      onLiveBlock: this.liveBlocks
        ? (chatId, block) => { this.liveBlocks!.publish(chatId, block) }
        : undefined,
      onBackgroundTaskLaunch: this.backgroundTaskOutputRegistry
        ? (chatId, taskId, outputPath) => {
            this.backgroundTaskOutputRegistry!.trackTask(chatId, taskId, outputPath)
          }
        : undefined,
      onBackgroundTaskSettle: this.backgroundTaskOutputRegistry
        ? (chatId, taskId) => {
            this.backgroundTaskOutputRegistry!.untrackTask(chatId, taskId)
          }
        : undefined,
    }
  }

  async runClaudeSession(session: ClaudeSessionState) {
    return runClaudeSessionLoop(this.runClaudeSessionDeps(), session)
  }


  private runTurnDeps(): RunTurnDeps {
    return {
      store: this.store,
      activeTurns: this.activeTurns,
      drainingStreams: this.drainingStreams,
      oauthPool: this.oauthPool,
      codexLimitDetector: this.codexLimitDetector,
      handleLimitError: (chatId, detector, error) => handleLimitErrorFn(this.sessionErrorHandlerDeps(), chatId, detector, error),
      emitStateChange: (chatId) => { this.emitStateChange(chatId) },
      clearDrainingStream: (chatId) => { this.clearDrainingStream(chatId) },
      startTurnForChat: (args) => this.startTurnForChat(args),
      maybeStartNextQueuedMessage: (chatId) => this.maybeStartNextQueuedMessage(chatId),
      stopCodexSession: (chatId) => this.codexManager.stopSession(chatId),
      turnEndGuard: this._codexTurnEndGuard,
    }
  }



  async emitAutoContinueEvent(event: AutoContinueEvent): Promise<void> {
    await emitAutoContinueEventFn(this.autoContinueDeps(), event)
  }




  async fireAutoContinue(chatId: string, scheduleId: string) {
    return fireAutoContinueFn(this.autoContinueDeps(), chatId, scheduleId)
  }

  async acceptAutoContinue(chatId: string, scheduleId: string, scheduledAt: number): Promise<void> {
    return acceptAutoContinueFn(this.autoContinueDeps(), chatId, scheduleId, scheduledAt)
  }

  async rescheduleAutoContinue(chatId: string, scheduleId: string, scheduledAt: number): Promise<void> {
    return rescheduleAutoContinueFn(this.autoContinueDeps(), chatId, scheduleId, scheduledAt)
  }

  async cancelAutoContinue(chatId: string, scheduleId: string, reason: "user" | "chat_deleted"): Promise<void> {
    return cancelAutoContinueFn(this.autoContinueDeps(), chatId, scheduleId, reason)
  }

  private async deliverSubagentToMain(
    chatId: string,
    runId: string,
    outcome: BackgroundRunOutcome,
  ): Promise<void> {
    return deliverSubagentToMainFn(this.loopCommandDeps(), chatId, runId, outcome)
  }

  async recoverArmedLoopWakes(): Promise<string[]> {
    return recoverArmedLoopWakesFn(this.loopCommandDeps())
  }

  async setupLoop(args: {
    chatId: string
    input: LoopSetupInput
  }): Promise<SetupLoopHandlerResult> {
    return setupLoopFn(this.loopCommandDeps(), args)
  }

  isLoopArmed(chatId: string): LoopState | null {
    return isLoopArmedFn(this.loopCommandDeps(), chatId)
  }

  async stopLoop(chatId: string, reason: "goal_met" | "user_send" | "chat_deleted"): Promise<void> {
    return stopLoopFn(this.loopCommandDeps(), chatId, reason)
  }

  async resumeLoop(chatId: string): Promise<ResumeLoopResult> {
    return resumeLoopFn(this.loopCommandDeps(), chatId)
  }

  onCronJobsChange: (() => void) | null = null

  async runCronCommand(
    chatId: string,
    result: import("../shared/cron/types").CronParseResult,
    model?: string,
  ): Promise<string | null> {
    return runCronCommandFn(this.cronCommandDeps(), chatId, result, model)
  }

  async armCron(chatId: string, command: string): Promise<{ jobId: string }> {
    const parsed = parseCronCommand(command)
    if (!parsed?.ok || parsed.command.sub !== "arm") {
      throw new Error(`not an armable /cron command: ${command}`)
    }
    const deps = { ...this.cronCommandDeps(), cronConfirm: undefined }
    const jobId = await runCronCommandFn(deps, chatId, parsed)
    if (!jobId) throw new Error(`arm_cron: no job id returned for command: ${command}`)
    return { jobId }
  }

  async updateCron(
    chatId: string,
    jobId: string,
    patch: import("../shared/cron/types").CronJobPatch,
  ): Promise<void> {
    await runCronCommandFn(this.cronCommandDeps(), chatId, {
      ok: true,
      command: { sub: "update", jobId, patch },
    })
  }

  async disarmCronJobsForChat(chatId: string): Promise<void> {
    await disarmCronJobsForChatFn(this.cronCommandDeps(), chatId)
    this.cronScheduler?.clearChat(chatId)
    this.cronSkipCoalescer.clearChat(chatId)
  }

  async fireCronJob(chatId: string, jobId: string): Promise<void> {
    return fireCronJobFn(this.cronFireDeps(), chatId, jobId)
  }

  async reconcileCronRunsAtBoot(
    missed: ReadonlyArray<{ chatId: string; jobId: string; missedCount: number }>,
    chatIds: readonly string[],
  ): Promise<void> {
    return reconcileCronRunsAtBootFn(
      {
        ...this.cronCommandDeps(),
        getQueuedMessages: (chatId) => this.store.getQueuedMessages(chatId),
      },
      missed,
      chatIds,
    )
  }

  async drainCronOutcomes(): Promise<void> {
    if (this.pendingCronOutcomes.size === 0) return
    await Promise.allSettled([...this.pendingCronOutcomes])
  }

  listLiveSchedules(chatId: string): string[] {
    return listLiveSchedulesFn(this.loopCommandDeps(), chatId)
  }

  async cancel(chatId: string, options?: { hideInterrupted?: boolean }) {
    return cancelChatFn(this.cancelHandlerDeps(), chatId, options)
  }

  async respondTool(command: Extract<ClientCommand, { type: "chat.respondTool" }>) {
    return respondToolFn(this.toolRespondDeps(), command)
  }

  async respondSubagentTool(command: Extract<ClientCommand, { type: "chat.respondSubagentTool" }>) {
    return respondSubagentToolFn(this.subagentToolResponseDeps(), command)
  }

  async cancelSubagentRun(
    command: Extract<ClientCommand, { type: "chat.cancelSubagentRun" }>,
  ) {
    cancelSubagentRunFn(this.subagentToolResponseDeps(), command)
  }
}
