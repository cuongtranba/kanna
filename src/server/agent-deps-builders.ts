/**
 * Builder functions for all 18 *Deps objects used by AgentCoordinator.
 *
 * Each function takes the coordinator instance and returns the typed *Deps
 * object that the corresponding functional module expects. Using
 * `import type { AgentCoordinator }` avoids a circular runtime dependency
 * (the import is erased at compile time).
 *
 * **Visibility requirement:** All AgentCoordinator fields and methods accessed
 * here must be declared `readonly` (not `private readonly`) so TypeScript
 * allows external access.
 */

import type { AgentCoordinator } from "./agent-coordinator"
import { ensureFreshMcpToken } from "./mcp-oauth.adapter"
import { realpathAdapter } from "./paths-fs.adapter"
import {
  ensureTrackingFile,
  inspectTrackingFile,
  isWorktreeOfSameRepo,
  readOracleScript,
} from "./loop-template-io.adapter"
import { runVerifyCommand } from "./loop-verify-io.adapter"
import { homedir } from "node:os"
import { isClaudeSdkProvider } from "./provider-catalog"

import type { ClaudeSessionConfigHelpersDeps } from "./claude-session-config-helpers"
import type { SessionLifecycleDeps } from "./claude-session-lifecycle"
import type { SessionErrorHandlerDeps } from "./claude-session-error-handler"
import type { AutoContinueCommandDeps } from "./claude-autocontinue-commands"
import type { LoopCommandDeps } from "./claude-loop-commands"
import { toArmedLoopInfo } from "./claude-loop-commands"
import type { CronCommandDeps } from "./cron/commands"
import type { CronFireDeps } from "./cron/fire"
import { isChatBusy } from "./claude-session-state-queries"
import type { CancelHandlerDeps } from "./claude-cancel-handler"
import type { ChatManagementDeps } from "./claude-chat-management"
import type { SendCommandDeps } from "./claude-send-command"
import type { ClearChatContextDeps } from "./claude-context-commands"
import type { SubagentWiringDeps } from "./claude-subagent-wiring"
import type { SubagentToolResponseDeps } from "./claude-subagent-tool-response"
import type { ToolRespondDeps } from "./claude-tool-respond"
import type { SessionStateQueryDeps } from "./claude-session-state-queries"
import type { StartTurnDeps } from "./claude-turn-starter"
import type { SpawnClaudeTurnDeps } from "./claude-session-spawner"
import type { RunClaudeSessionDeps } from "./claude-session-runner"
import type { RunTurnDeps } from "./claude-turn-runner"
import { createMermaidGuard, type MermaidGuard } from "./mermaid-guard"
import { createCronRepair, type CronRepair } from "./cron/repair"
import { createCronConfirm, type CronConfirm } from "./cron/confirm"
import { parseMermaid } from "./mermaid-parse.adapter"
import { repairMermaidSource } from "../shared/mermaidRepair"
import { resolveSpawnPaths } from "./claude-session-config"

// ---------------------------------------------------------------------------
// 1. Session config helpers
// ---------------------------------------------------------------------------

export function buildClaudeSessionConfigHelpersDeps(agent: AgentCoordinator): ClaudeSessionConfigHelpersDeps {
  return {
    getAppSettingsSnapshot: () => agent.getAppSettingsSnapshot(),
    chatPolicy: agent.chatPolicy,
    store: agent.store,
    ptyInstanceRegistry: agent.ptyInstanceRegistry,
    ensureFreshToken: (server, opts) => ensureFreshMcpToken(server, opts),
    persistOAuthState: agent.persistOAuthStateFn,
    killProcessTree: async (pid) => {
      const { killProcessTree } = await import("./claude-pty/pid-registry.adapter")
      await killProcessTree(pid)
    },
  }
}

// ---------------------------------------------------------------------------
// 2. Session lifecycle
// ---------------------------------------------------------------------------

export function buildSessionLifecycleDeps(agent: AgentCoordinator): SessionLifecycleDeps {
  return {
    getAppSettingsSnapshot: () => agent.getAppSettingsSnapshot(),
    defaultIdleMs: agent.claudeSessionLifecycle.idleMs,
    defaultMaxResidentSessions: agent.claudeSessionLifecycle.maxResidentSessions,
    claudeSessions: agent.claudeSessions,
    activeTurns: agent.activeTurns,
    startingTurns: agent.startingTurns,
    pendingTools: agent.pendingTools,
    oauthPool: agent.oauthPool,
    workflowRegistry: agent.workflowRegistry,
    resolveClaudeDriverPreference: () => agent.resolveClaudeDriverPreference(),
    emitStateChange: (chatId: string) => { agent.emitStateChange(chatId) },
    store: agent.store,
    homeDir: homedir(),
  }
}

// ---------------------------------------------------------------------------
// 3. Session error handler
// ---------------------------------------------------------------------------

export function buildSessionErrorHandlerDeps(agent: AgentCoordinator): SessionErrorHandlerDeps {
  return {
    tokenRotationDedupe: agent.tokenRotationDedupe,
    claudeSessions: agent.claudeSessions,
    activeTurns: agent.activeTurns,
    oauthPool: agent.oauthPool,
    store: agent.store,
    resolveAutoResumeFor: (chatId: string) => agent.resolveAutoResumeFor(chatId),
    emitAutoContinueEvent: (event) => agent.emitAutoContinueEvent(event),
    closeClaudeSession: (chatId, session, opts?) =>
      agent.closeClaudeSession(chatId, session, opts),
  }
}

// ---------------------------------------------------------------------------
// 4. Auto-continue commands
// ---------------------------------------------------------------------------

export function buildAutoContinueCommandDeps(agent: AgentCoordinator): AutoContinueCommandDeps {
  return {
    autoResumeByChat: agent.autoResumeByChat,
    getAutoResumePreference: () => agent.getAutoResumePreference(),
    store: agent.store,
    scheduleManager: agent.scheduleManager,
    emitStateChange: (chatId: string) => { agent.emitStateChange(chatId) },
    enqueueMessage: (chatId, content, attachments, options) =>
      agent.enqueueMessage(chatId, content, attachments, options),
    maybeStartNextQueuedMessage: (chatId) => agent.maybeStartNextQueuedMessage(chatId),
  }
}

// ---------------------------------------------------------------------------
// 5. Loop commands
// ---------------------------------------------------------------------------

export function buildLoopCommandDeps(agent: AgentCoordinator): LoopCommandDeps {
  return {
    store: agent.store,
    claudeSessions: agent.claudeSessions,
    activeTurns: agent.activeTurns,
    startingTurns: agent.startingTurns,
    getSubagents: () => agent.getSubagents(),
    getAppSettingsSnapshot: () => agent.getAppSettingsSnapshot(),
    closeClaudeSession: (chatId, session) => agent.closeClaudeSession(chatId, session),
    emitAutoContinueEvent: (event) => agent.emitAutoContinueEvent(event),
    ensureTrackingFile,
    inspectTrackingFile,
    isWorktreeOfSameRepo,
    runVerifyCommand,
    readOracleScript,
    isLoopArmed: (chatId) => agent.isLoopArmed(chatId),
    isChatBusy: (chatId) => isChatBusy(buildSendCommandDeps(agent), chatId),
  }
}

// ---------------------------------------------------------------------------
// 5b. Cron commands
// ---------------------------------------------------------------------------

export function buildCronCommandDeps(agent: AgentCoordinator): CronCommandDeps {
  return {
    store: agent.store,
    cronScheduler: agent.cronScheduler,
    skipCoalescer: agent.cronSkipCoalescer,
    emitStateChange: (chatId) => agent.emitStateChange(chatId),
    pushCronJobsUpdate: () => agent.onCronJobsChange?.(),
    cronRepair: buildCronRepair(agent),
    cronConfirm: buildCronConfirm(agent),
    resolveChatCwd: (chatId) => {
      const chat = agent.store.getChat(chatId)
      if (!chat) return undefined
      const project = agent.store.getProject(chat.projectId)
      if (!project) return undefined
      return resolveSpawnPaths(chat, project.localPath).cwd
    },
  }
}

/**
 * One repair per coordinator. Its "already asked about this line" memory has
 * to outlive a single command — a fresh one per dispatch would re-offer the
 * same unrepairable line every time the user retyped it, which is the exact
 * shape of the failure this exists to fix.
 */
const cronRepairByAgent = new WeakMap<AgentCoordinator, CronRepair>()

function buildCronRepair(agent: AgentCoordinator): CronRepair {
  const existing = cronRepairByAgent.get(agent)
  if (existing) return existing

  const repair = createCronRepair({
    enabled: process.env.KANNA_CRON_REPAIR !== "disabled",
    hasQueuedMessage: (chatId) => agent.store.getQueuedMessages(chatId).length > 0,
    enqueueMessage: async (chatId, content, options) => {
      await agent.enqueueMessage(chatId, content, [], options)
    },
    // `/cron` starts no turn, so unlike the mermaid guard nothing else will
    // come along and drain this.
    drainQueue: async (chatId) => {
      await agent.maybeStartNextQueuedMessage(chatId)
    },
  })
  cronRepairByAgent.set(agent, repair)
  return repair
}

const cronConfirmByAgent = new WeakMap<AgentCoordinator, CronConfirm>()

function buildCronConfirm(agent: AgentCoordinator): CronConfirm {
  const existing = cronConfirmByAgent.get(agent)
  if (existing) return existing

  const confirm = createCronConfirm({
    enabled: process.env.KANNA_CRON_CONFIRM !== "disabled",
    hasQueuedMessage: (chatId) => agent.store.getQueuedMessages(chatId).length > 0,
    enqueueMessage: async (chatId, content, options) => {
      await agent.enqueueMessage(chatId, content, [], options)
    },
    drainQueue: async (chatId) => {
      await agent.maybeStartNextQueuedMessage(chatId)
    },
  })
  cronConfirmByAgent.set(agent, confirm)
  return confirm
}

export function buildCronFireDeps(agent: AgentCoordinator): CronFireDeps {
  return {
    ...buildCronCommandDeps(agent),
    skipCoalescer: agent.cronSkipCoalescer,
    getChatRecord: (chatId) => agent.store.getChat(chatId),
    isChatBusy: (chatId) => isChatBusy(buildSendCommandDeps(agent), chatId),
    clearChatContext: (chatId) => agent.clearChatContext(chatId),
    createChat: (projectId) => agent.store.createChat(projectId),
    enqueueMessage: (chatId, content, attachments, options) =>
      agent.enqueueMessage(chatId, content, attachments, options),
    maybeStartNextQueuedMessage: async (chatId) => agent.maybeStartNextQueuedMessage(chatId),
    onChatSpawned: agent.boardRegistry
      ? (originChatId, spawnedChatId) => {
          const registry = agent.boardRegistry!
          for (const card of registry.findCardsByLink("chat", originChatId)) {
            registry.addCardLink(card.id, "chat", spawnedChatId)
          }
        }
      : undefined,
  }
}

// ---------------------------------------------------------------------------
// 6. Cancel handler
// ---------------------------------------------------------------------------

export function buildCancelHandlerDeps(agent: AgentCoordinator): CancelHandlerDeps {
  return {
    drainingStreams: agent.drainingStreams,
    rejectPendingResolversForChat: (chatId) => agent.rejectPendingResolversForChat(chatId),
    cancelChatInOrchestrator: (chatId) => agent.getSubagentOrchestrator().cancelChat(chatId),
    activeTurns: agent.activeTurns,
    pendingTools: agent.pendingTools,
    startingTurns: agent.startingTurns,
    store: agent.store,
    claudeSessions: agent.claudeSessions,
    emitStateChange: (chatId) => agent.emitStateChange(chatId),
    resolveClaudeDriverPreference: () => agent.resolveClaudeDriverPreference(),
    closeClaudeSession: (chatId, session) => agent.closeClaudeSession(chatId, session),
  }
}

// ---------------------------------------------------------------------------
// 7. Chat management
// ---------------------------------------------------------------------------

export function buildChatManagementDeps(agent: AgentCoordinator): ChatManagementDeps {
  return {
    activeTurns: agent.activeTurns,
    drainingStreams: agent.drainingStreams,
    claudeSessions: agent.claudeSessions,
    autoResumeByChat: agent.autoResumeByChat,
    store: agent.store,
    analytics: agent.analytics,
    cancel: (chatId, options) => agent.cancel(chatId, options),
    closeClaudeSession: (chatId, session, opts) => agent.closeClaudeSession(chatId, session, opts),
    emitStateChange: (chatId) => agent.emitStateChange(chatId),
    generateTitle: (messageContent, cwd) => agent.generateTitle(messageContent, cwd),
    reportBackgroundError: agent.reportBackgroundError,
    dequeueAndStartQueuedMessage: (chatId, queuedMessage, options) =>
      agent.dequeueAndStartQueuedMessage(chatId, queuedMessage, options),
  }
}

// ---------------------------------------------------------------------------
// 8. Send command
// ---------------------------------------------------------------------------

export function buildSendCommandDeps(agent: AgentCoordinator): SendCommandDeps {
  return {
    store: agent.store,
    activeTurns: agent.activeTurns,
    startingTurns: agent.startingTurns,
    pendingTools: agent.pendingTools,
    claudeSessions: agent.claudeSessions,
    resolveBackgroundTaskMaxMs: () => agent.resolveBackgroundTaskMaxMs(),
    autoResumeByChat: agent.autoResumeByChat,
    analytics: agent.analytics,
    getAppSettingsSnapshot: () => agent.getAppSettingsSnapshot(),
    stopLoop: (chatId, reason) => agent.stopLoop(chatId, reason),
    emitStateChange: (chatId) => agent.emitStateChange(chatId),
    startTurnForChat: (args) => agent.startTurnForChat(args),
    clearChatContext: (chatId) => agent.clearChatContext(chatId),
    runCronCommand: (chatId, result, model) => agent.runCronCommand(chatId, result, model),
  }
}

export function buildClearChatContextDeps(agent: AgentCoordinator): ClearChatContextDeps {
  return {
    store: agent.store,
    claudeSessions: agent.claudeSessions,
    activeTurns: agent.activeTurns,
    startingTurns: agent.startingTurns,
    closeClaudeSession: (chatId, session) => agent.closeClaudeSession(chatId, session),
    stopCodexSession: (chatId) => agent.codexManager.stopSession(chatId),
    emitStateChange: (chatId) => agent.emitStateChange(chatId),
  }
}

// ---------------------------------------------------------------------------
// 9. Subagent wiring
// ---------------------------------------------------------------------------

export function buildSubagentWiringDeps(agent: AgentCoordinator): SubagentWiringDeps {
  return {
    store: agent.store,
    startClaudeSessionFn: agent.startClaudeSessionFn,
    startClaudeSessionPTYFn: agent.startClaudeSessionPTYFn,
    toolCallback: agent.toolCallback,
    tunnelGateway: agent.tunnelGateway,
    claudePtyRegistry: agent.claudePtyRegistry,
    ptyInstanceRegistry: agent.ptyInstanceRegistry,
    workflowRegistry: agent.workflowRegistry,
    subagentOrchestrator: agent.getSubagentOrchestrator(),
    codexManager: agent.codexManager,
    oauthPool: agent.oauthPool,
    subagentPendingResolvers: agent.subagentPendingResolvers,
    realpath: realpathAdapter,
    resolveClaudeDriverPreference: () => agent.resolveClaudeDriverPreference(),
    getEnabledCustomMcpServers: () => agent.getEnabledCustomMcpServers(),
    buildOAuthBearers: (servers) => agent.buildOAuthBearers(servers),
    resolveChatPolicy: (chatId) => agent.resolveChatPolicy(chatId),
    emitStateChange: (chatId) => { agent.emitStateChange(chatId) },
    buildPoolUnavailableMessage: (reservedFor, scopeSuffix) =>
      agent.buildPoolUnavailableMessage(reservedFor, scopeSuffix),
    getAppSettingsSnapshot: () => agent.getAppSettingsSnapshot(),
    readLlmProvider: () => agent.readLlmProvider(),
    subagentPendingKey: (chatId, runId, toolUseId) =>
      agent.subagentPendingKey(chatId, runId, toolUseId),
    getArmedLoop: (chatId) => toArmedLoopInfo(agent.isLoopArmed(chatId)),
  }
}

// ---------------------------------------------------------------------------
// 11. Subagent tool response
// ---------------------------------------------------------------------------

export function buildSubagentToolResponseDeps(agent: AgentCoordinator): SubagentToolResponseDeps {
  return {
    subagentPendingResolvers: agent.subagentPendingResolvers,
    store: agent.store,
    subagentOrchestrator: agent.getSubagentOrchestrator(),
    emitStateChange: (chatId) => { agent.emitStateChange(chatId) },
  }
}

// ---------------------------------------------------------------------------
// 12. Tool respond
// ---------------------------------------------------------------------------

export function buildToolRespondDeps(agent: AgentCoordinator): ToolRespondDeps {
  return {
    activeTurns: agent.activeTurns,
    pendingTools: agent.pendingTools,
    store: agent.store,
    emitStateChange: (chatId) => { agent.emitStateChange(chatId) },
  }
}

// ---------------------------------------------------------------------------
// 13. Session state queries
// ---------------------------------------------------------------------------

export function buildSessionStateQueryDeps(agent: AgentCoordinator): SessionStateQueryDeps {
  return {
    activeTurns: agent.activeTurns,
    startingTurns: agent.startingTurns,
    pendingTools: agent.pendingTools,
    claudeSessions: agent.claudeSessions,
    drainingStreams: agent.drainingStreams,
    isClaudeSdkProvider: (provider) => isClaudeSdkProvider(provider),
    hasPendingBackgroundTask: (session, now) => agent.hasPendingBackgroundTask(session, now),
    resolveClaudeIdleMs: () => agent.resolveClaudeIdleMs(),
    resolveBackgroundTaskMaxMs: () => agent.resolveBackgroundTaskMaxMs(),
    resolveBackgroundTaskMaxWakes: () => agent.resolveBackgroundTaskMaxWakes(),
    hasLiveWorkflow: (chatId) => agent.hasLiveWorkflow(chatId),
    closeClaudeSession: (chatId, session) => { agent.closeClaudeSession(chatId, session) },
    emitStateChange: (chatId) => { agent.emitStateChange(chatId) },
    wakeBackgroundTaskSession: (chatId, taskIds, wakeNumber, maxWakes) => {
      agent.wakeBackgroundTaskSession(chatId, taskIds, wakeNumber, maxWakes)
    },
    notifyBackgroundTasksAbandoned: (chatId, taskIds) => {
      agent.notifyBackgroundTasksAbandoned(chatId, taskIds)
    },
  }
}

// ---------------------------------------------------------------------------
// 14. Start turn
// ---------------------------------------------------------------------------

export function buildStartTurnDeps(agent: AgentCoordinator): StartTurnDeps {
  return {
    activeTurns: agent.activeTurns,
    startingTurns: agent.startingTurns,
    claudeSessions: agent.claudeSessions,
    drainingStreams: agent.drainingStreams,
    mentionedSubagentIdsByChat: agent.mentionedSubagentIdsByChat,
    store: agent.store,
    codexManager: agent.codexManager,
    subagentOrchestrator: agent.getSubagentOrchestrator(),
    clearDrainingStream: (chatId) => agent.clearDrainingStream(chatId),
    emitStateChange: (chatId, opts) => agent.emitStateChange(chatId, opts),
    resolveClaudeDriverPreference: () => agent.resolveClaudeDriverPreference(),
    closeClaudeSession: (chatId, session) => agent.closeClaudeSession(chatId, session),
    getSubagents: () => agent.getSubagents(),
    getAppSettingsSnapshot: () => agent.getAppSettingsSnapshot(),
    generateTitleInBackground: (chatId, content, localPath, optimisticTitle) =>
      agent.generateTitleInBackground(chatId, content, localPath, optimisticTitle),
    pendingTools: agent.pendingTools,
    startClaudeTurn: (args) => agent.startClaudeTurn(args),
    findLastUserMessageId: (chatId) => agent.findLastUserMessageId(chatId),
    runTurn: (active) => agent.runTurn(active),
  }
}

// ---------------------------------------------------------------------------
// 16. Spawn Claude turn
// ---------------------------------------------------------------------------

export function buildSpawnClaudeTurnDeps(agent: AgentCoordinator): SpawnClaudeTurnDeps {
  return {
    claudeSessions: agent.claudeSessions,
    activeTurns: agent.activeTurns,
    mentionedSubagentIdsByChat: agent.mentionedSubagentIdsByChat,
    oauthPool: agent.oauthPool,
    store: agent.store,
    startClaudeSessionFn: agent.startClaudeSessionFn,
    startClaudeSessionPTYFn: agent.startClaudeSessionPTYFn,
    subagentOrchestrator: agent.getSubagentOrchestrator(),
    toolCallback: agent.toolCallback,
    tunnelGateway: agent.tunnelGateway,
    claudePtyRegistry: agent.claudePtyRegistry,
    ptyInstanceRegistry: agent.ptyInstanceRegistry,
    workflowRegistry: agent.workflowRegistry,
    subagentTranscriptRegistry: agent.subagentTranscriptRegistry,
    resolveClaudeDriverPreference: () => agent.resolveClaudeDriverPreference(),
    isLoopArmed: (chatId) => agent.isLoopArmed(chatId),
    boardRegistry: agent.boardRegistry ?? undefined,
    closeClaudeSession: (chatId, session) => agent.closeClaudeSession(chatId, session),
    enforceClaudeSessionBudget: (protectedChatId?) => agent.enforceClaudeSessionBudget(protectedChatId),
    readLlmProvider: () => agent.readLlmProvider(),
    buildPoolUnavailableMessage: (reservedFor, scopeSuffix) =>
      agent.buildPoolUnavailableMessage(reservedFor, scopeSuffix),
    listOpenRouterModelsFn: agent.listOpenRouterModelsFn,
    getSubagents: () => agent.getSubagents(),
    getAppSettingsSnapshot: () => agent.getAppSettingsSnapshot(),
    getEnabledCustomMcpServers: () => agent.getEnabledCustomMcpServers(),
    buildOAuthBearers: (servers) => agent.buildOAuthBearers(servers),
    setupLoop: (chatId, input) => agent.setupLoop({ chatId, input }),
    armCron: (chatId, command) => agent.armCron(chatId, command),
    stopLoop: (chatId, reason) => agent.stopLoop(chatId, reason),
    resolveChatPolicy: (chatId) => agent.resolveChatPolicy(chatId),
    runClaudeSession: (session) => { void agent.runClaudeSession(session) },
    emitStateChange: (chatId) => { agent.emitStateChange(chatId) },
  }
}

// ---------------------------------------------------------------------------
// 17. Run Claude session
// ---------------------------------------------------------------------------

export function buildRunClaudeSessionDeps(agent: AgentCoordinator): RunClaudeSessionDeps {
  return {
    openrouterFirstEntryTimeoutMs: agent.openrouterFirstEntryTimeoutMs,
    claudeSessions: agent.claudeSessions,
    activeTurns: agent.activeTurns,
    pendingTools: agent.pendingTools,
    oauthPool: agent.oauthPool,
    claudeLimitDetector: agent.claudeLimitDetector,
    claudeAuthErrorDetector: agent.claudeAuthErrorDetector,
    throwOnClaudeSessionStart: agent.throwOnClaudeSessionStart,
    store: agent.store,
    emitStateChange: (chatId?) => { agent.emitStateChange(chatId) },
    handleLimitDetection: (chatId, detection) => agent.handleLimitDetection(chatId, detection),
    maybeRegisterSdkWorkflowsDir: (session) => { agent.maybeRegisterSdkWorkflowsDir(session) },
    getSubagents: () => agent.getSubagents(),
    resolveBackgroundTaskMaxMs: () => agent.resolveBackgroundTaskMaxMs(),
    handleLimitError: (chatId, detector, error) => agent.handleLimitError(chatId, detector, error),
    handleAuthFailure: (session, detection) => agent.handleAuthFailure(session, detection),
    closeClaudeSession: (chatId, session) => { agent.closeClaudeSession(chatId, session) },
    maybeStartNextQueuedMessage: (chatId) => agent.maybeStartNextQueuedMessage(chatId),
    resolveClaudeDriverPreference: () => agent.resolveClaudeDriverPreference(),
    mermaidGuard: buildMermaidGuard(agent),
    onBackgroundTaskLaunch: agent.backgroundTaskOutputRegistry
      ? (chatId, taskId, outputPath) => {
          agent.backgroundTaskOutputRegistry!.trackTask(chatId, taskId, outputPath)
        }
      : undefined,
    onBackgroundTaskSettle: agent.backgroundTaskOutputRegistry
      ? (chatId, taskId) => {
          agent.backgroundTaskOutputRegistry!.untrackTask(chatId, taskId)
        }
      : undefined,
  }
}

/**
 * One guard per coordinator. Its "already asked about this diagram" memory has
 * to outlive a single turn — a fresh guard per turn would ask about the same
 * unfixable diagram forever.
 */
const mermaidGuardByAgent = new WeakMap<AgentCoordinator, MermaidGuard>()

function buildMermaidGuard(agent: AgentCoordinator): MermaidGuard {
  const existing = mermaidGuardByAgent.get(agent)
  if (existing) return existing

  const guard = createMermaidGuard({
    enabled: process.env.KANNA_MERMAID_GUARD !== "disabled",
    parse: parseMermaid,
    // The same repair the renderer applies before it gives up, so the guard
    // fires exactly when the reader would see an error rather than a diagram.
    repair: (source) => {
      const result = repairMermaidSource(source)
      return { source: result.source, repaired: result.repairs.length > 0 }
    },
    hasQueuedMessage: (chatId) => agent.store.getQueuedMessages(chatId).length > 0,
    enqueueMessage: async (chatId, content, options) => {
      await agent.enqueueMessage(chatId, content, [], options)
    },
  })
  mermaidGuardByAgent.set(agent, guard)
  return guard
}

// ---------------------------------------------------------------------------
// 18. Run turn
// ---------------------------------------------------------------------------

export function buildRunTurnDeps(agent: AgentCoordinator): RunTurnDeps {
  return {
    store: agent.store,
    activeTurns: agent.activeTurns,
    drainingStreams: agent.drainingStreams,
    oauthPool: agent.oauthPool,
    codexLimitDetector: agent.codexLimitDetector,
    handleLimitError: (chatId, detector, error) => agent.handleLimitError(chatId, detector, error),
    emitStateChange: (chatId) => { agent.emitStateChange(chatId) },
    clearDrainingStream: (chatId) => { agent.clearDrainingStream(chatId) },
    startTurnForChat: (args) => agent.startTurnForChat(args),
    maybeStartNextQueuedMessage: (chatId) => agent.maybeStartNextQueuedMessage(chatId),
    stopCodexSession: (chatId) => agent.codexManager.stopSession(chatId),
  }
}
