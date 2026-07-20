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
import { ensureTrackingFile } from "./loop-template-io.adapter"
import { homedir } from "node:os"
import { providerUsesSdkSession } from "../shared/types"
import { isClaudeSdkProvider } from "./provider-catalog"

import type { ClaudeSessionConfigHelpersDeps } from "./claude-session-config-helpers"
import type { SessionLifecycleDeps } from "./claude-session-lifecycle"
import type { SessionErrorHandlerDeps } from "./claude-session-error-handler"
import type { AutoContinueCommandDeps } from "./claude-autocontinue-commands"
import type { LoopOrchCommandDeps } from "./claude-loop-orch-commands"
import type { CancelHandlerDeps } from "./claude-cancel-handler"
import type { ChatManagementDeps } from "./claude-chat-management"
import type { SendCommandDeps } from "./claude-send-command"
import type { SubagentWiringDeps } from "./claude-subagent-wiring"
import type { SlashCommandsDeps } from "./claude-slash-commands"
import type { SubagentToolResponseDeps } from "./claude-subagent-tool-response"
import type { ToolRespondDeps } from "./claude-tool-respond"
import type { SessionStateQueryDeps } from "./claude-session-state-queries"
import type { StartTurnDeps } from "./claude-turn-starter"
import type { SessionRebuildDeps } from "./claude-session-rebuild"
import type { SpawnClaudeTurnDeps } from "./claude-session-spawner"
import type { RunClaudeSessionDeps } from "./claude-session-runner"
import type { RunTurnDeps } from "./claude-turn-runner"

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
// 5. Loop / orch commands
// ---------------------------------------------------------------------------

export function buildLoopOrchCommandDeps(agent: AgentCoordinator): LoopOrchCommandDeps {
  return {
    store: agent.store,
    orchestrationQueue: agent.getOrchestrationQueue(),
    claudeSessions: agent.claudeSessions,
    activeTurns: agent.activeTurns,
    getSubagents: () => agent.getSubagents(),
    getAppSettingsSnapshot: () => agent.getAppSettingsSnapshot(),
    buildSubagentProviderRunForChat: (args) => agent.buildSubagentProviderRunForChat(args),
    closeClaudeSession: (chatId, session) => agent.closeClaudeSession(chatId, session),
    emitAutoContinueEvent: (event) => agent.emitAutoContinueEvent(event),
    ensureTrackingFile,
    isLoopArmed: (chatId) => agent.isLoopArmed(chatId),
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
    store: agent.store,
    claudeSessions: agent.claudeSessions,
    emitStateChange: (chatId) => agent.emitStateChange(chatId),
    resolveClaudeDriverPreference: () => agent.resolveClaudeDriverPreference(),
    closeClaudeSession: (chatId, session) => agent.closeClaudeSession(chatId, session),
    maybeStartNextQueuedMessage: async (chatId) => { await agent.maybeStartNextQueuedMessage(chatId) },
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
    claudeSessions: agent.claudeSessions,
    autoResumeByChat: agent.autoResumeByChat,
    analytics: agent.analytics,
    getAppSettingsSnapshot: () => agent.getAppSettingsSnapshot(),
    stopLoop: (chatId, reason) => agent.stopLoop(chatId, reason),
    emitStateChange: (chatId) => agent.emitStateChange(chatId),
    startTurnForChat: (args) => agent.startTurnForChat(args),
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
  }
}

// ---------------------------------------------------------------------------
// 10. Slash commands
// ---------------------------------------------------------------------------

export function buildSlashCommandsDeps(agent: AgentCoordinator): SlashCommandsDeps {
  return {
    store: agent.store,
    claudeSessions: agent.claudeSessions,
    oauthPool: agent.oauthPool,
    slashCommandsInFlight: agent.slashCommandsInFlight,
    cliCommandCache: agent.slashCommandCache,
    emitStateChange: (chatId) => { agent.emitStateChange(chatId) },
    resolveClaudeDriverPreference: () => agent.resolveClaudeDriverPreference(),
    startClaudeSessionPTY: agent.startClaudeSessionPTYFn,
    startClaudeSessionSDK: agent.startClaudeSessionFn,
    getSubagents: () => agent.getSubagents(),
    getGlobalPromptAppend: () => agent.getAppSettingsSnapshot().globalPromptAppend,
    getEnabledCustomMcpServers: () => agent.getEnabledCustomMcpServers(),
    claudePtyRegistry: agent.claudePtyRegistry,
    ptyInstanceRegistry: agent.ptyInstanceRegistry,
    workflowRegistry: agent.workflowRegistry,
    subagentTranscriptRegistry: agent.subagentTranscriptRegistry,
    localCatalog: agent.localCatalog,
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
    claudeSessions: agent.claudeSessions,
    drainingStreams: agent.drainingStreams,
    slashCommandsInFlight: agent.slashCommandsInFlight,
    isClaudeSdkProvider: (provider) => isClaudeSdkProvider(provider),
    hasPendingBackgroundTask: (session, now) => agent.hasPendingBackgroundTask(session, now),
    resolveClaudeIdleMs: () => agent.resolveClaudeIdleMs(),
    hasLiveWorkflow: (chatId) => agent.hasLiveWorkflow(chatId),
    closeClaudeSession: (chatId, session) => { agent.closeClaudeSession(chatId, session) },
    emitStateChange: (chatId) => { agent.emitStateChange(chatId) },
  }
}

// ---------------------------------------------------------------------------
// 14. Start turn
// ---------------------------------------------------------------------------

export function buildStartTurnDeps(agent: AgentCoordinator): StartTurnDeps {
  return {
    activeTurns: agent.activeTurns,
    claudeSessions: agent.claudeSessions,
    drainingStreams: agent.drainingStreams,
    mentionedSubagentIdsByChat: agent.mentionedSubagentIdsByChat,
    store: agent.store,
    codexManager: agent.codexManager,
    subagentOrchestrator: agent.getSubagentOrchestrator(),
    clearDrainingStream: (chatId) => agent.clearDrainingStream(chatId),
    emitStateChange: (chatId, opts) => agent.emitStateChange(chatId, opts),
    resolveClaudeDriverPreference: () => agent.resolveClaudeDriverPreference(),
    getSubagents: () => agent.getSubagents(),
    getAppSettingsSnapshot: () => agent.getAppSettingsSnapshot(),
    generateTitleInBackground: (chatId, content, localPath, optimisticTitle) =>
      agent.generateTitleInBackground(chatId, content, localPath, optimisticTitle),
    recreateActiveTurnFromSession: (args) => agent.recreateActiveTurnFromSession(args),
    startClaudeTurn: (args) => agent.startClaudeTurn(args),
    findLastUserMessageId: (chatId) => agent.findLastUserMessageId(chatId),
    runTurn: (active) => agent.runTurn(active),
  }
}

// ---------------------------------------------------------------------------
// 15. Session rebuild
// ---------------------------------------------------------------------------

export function buildSessionRebuildDeps(agent: AgentCoordinator): SessionRebuildDeps {
  return {
    claudeSessions: agent.claudeSessions,
    activeTurns: agent.activeTurns,
    providerUsesSdkSession: (provider) => providerUsesSdkSession(provider),
    getMessages: (chatId) => agent.store.getMessages(chatId),
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
    stopLoop: (chatId, reason) => agent.stopLoop(chatId, reason),
    runOrchestration: (chatId, input) => agent.runOrchestration(chatId, input),
    cancelOrchRun: (runId) => agent.cancelOrchRun(runId),
    getOrchRunDetail: (runId) => agent.getOrchRunDetail(runId),
    resolveChatPolicy: (chatId) => agent.resolveChatPolicy(chatId),
    runClaudeSession: (session) => { void agent.runClaudeSession(session) },
    mergeLocalCatalog: (commands, cwd) => agent.mergeLocalCatalog(commands, cwd),
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
    mergeLocalCatalog: (commands, cwd) => agent.mergeLocalCatalog(commands, cwd),
    handleLimitError: (chatId, detector, error) => agent.handleLimitError(chatId, detector, error),
    handleAuthFailure: (session, detection) => agent.handleAuthFailure(session, detection),
    closeClaudeSession: (chatId, session) => { agent.closeClaudeSession(chatId, session) },
    maybeStartNextQueuedMessage: (chatId) => agent.maybeStartNextQueuedMessage(chatId),
    resolveClaudeDriverPreference: () => agent.resolveClaudeDriverPreference(),
  }
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
  }
}
