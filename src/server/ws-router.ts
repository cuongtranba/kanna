import { randomUUID } from "node:crypto"
import type { CommandOrigin } from "../shared/command-origin"
import { isJsonObject, safeJsonParse, type JsonValue } from "../shared/json"
import { log } from "../shared/log"
import type { ServerWebSocket } from "bun"
import { PROTOCOL_VERSION } from "../shared/types"
import { parseClientCommand } from "../shared/commands"
import type { ClientCommand, ClientEnvelope, ServerEnvelope, SubscriptionTopic } from "../shared/protocol"
import { isClientEnvelope, isServerEnvelope } from "../shared/protocol"
import type { AgentCoordinator } from "./agent"
import type { AnalyticsReporter } from "./analytics"
import { NoopAnalyticsReporter } from "./analytics"
import type { AppSettingsManager } from "./app-settings"
import type { DiscoveredProject } from "./discovery.adapter"
import { stampCommandOrigin } from "./command-origin-stamp"
import { DiffStore } from "./diff-store"
import { EventStore } from "./event-store"
import { openExternal } from "./external-open"
import { KeybindingsManager } from "./keybindings"
import { resolveLocalPath } from "./paths"
import { resolveSpawnPaths } from "./claude-session-config"
import { ensureProjectDirectory } from "./project-directory.adapter"
import { TerminalManager } from "./terminal-manager"
import type { UpdateManager } from "./update-manager"
import type {
  LlmProviderSnapshot,
  LlmProviderValidationResult,
  OpenRouterModel,
} from "../shared/types"
import { importClaudeSessions, importSessionsByIds } from "./claude-session-importer.adapter"
import { listWorktrees } from "./worktree-store.adapter"
import type { TunnelGateway } from "./cloudflare-tunnel/gateway"
import type { PushManager } from "./push/push-manager"
import type { SessionShareService } from "./session-share"
import type { WorkflowRegistry } from "./workflow-registry"
import type { BackgroundTaskOutputRegistry } from "./background-task-output-registry"
import type { LiveBlockHub } from "./live-block-throttle"
import { catalogSourcesOf, providerCatalogOf } from "./read-models"
import { handleBoardCommand } from "./ws-router-boards"
import type { StartWorkResult, StartWorkView } from "../shared/boards/start-work"
import type { CleanupDecision, WorktreeCleanupView } from "../shared/boards/worktree-cleanup"
import type { WorktreeCleanupOutcome } from "./board-worktree-cleanup"
import type { BoardRegistry } from "./board-registry"
import type { BeaconRegistry } from "./beacon-registry"
import type { BoardSync } from "./board-sync"
import type { SubagentTranscriptRegistry } from "./subagent-transcript-registry"
import type { FollowedSessionRegistry } from "./followed-session-registry"
import { buildFallbackDiffStore, buildFallbackLlmProvider, buildResolvedAppSettings } from "./ws-router-defaults"
import { handleSettingsCommand } from "./ws-router-settings"
import { handleDiffCommand } from "./ws-router-diff"
import { handleObservabilityCommand } from "./ws-router-observability"
import { handleAgentCtrlCommand } from "./ws-router-agent-ctrl"
import type { AgentCtrlCommandDeps } from "./ws-router-agent-ctrl"
import { handlePushCommand } from "./ws-router-push"
import { handleMiscCommand } from "./ws-router-misc"
import type { MiscCommandDeps } from "./ws-router-misc"
import { handleProjectCommand } from "./ws-router-project"
import { handleProjectPathsCommand, handleUploadDeleteCommand } from "./ws-router-project-files"
import { handlePluginsCommand, type PluginsHostDep } from "./ws-router-plugins"
import { listProjectPaths } from "./project-paths"
import { deleteProjectUpload } from "./uploads"
import { handleGenUICommand } from "./ws-router-genui"
import { handleInboxCommand, type InboxReplyAction } from "./ws-router-inbox"
import { handleWebhooksCommand } from "./ws-router-webhooks"
import type { InboxRegistry } from "./inbox/inbox-registry"
import type { McpSourcesTopic } from "./mcp-sources/mcp-sources-boot"
import { handleServiceBusCommand } from "./ws-router-service-bus"
import type { ServiceBusController } from "./service-bus/service-bus-boot"
import type { WebhookRegistry } from "./webhooks/webhook-registry"
import type { GenUIDatasetService } from "./genui/dataset-service"
import { deleteChatWithTeardown, handleChatCommand } from "./ws-router-chat"
import type { ChatCommandDeps } from "./ws-router-chat"
import { removeProjectKannaFiles } from "./project-kanna-files.adapter"
import { removeWorktree } from "./worktree-store.adapter"
import {
  ensureSnapshotSignatures,
  isBenignStaleStateMessage,
  logSendToStartingProfile,
  send,
  silentCommandMessage,
  unhandledCommandMessage,
} from "./ws-router-utils"
import type { ClientState, CommandConnection } from "./ws-router-utils"
import { createEnvelopeBuilder } from "./ws-router-envelope"
import { BroadcastManager } from "./ws-router-broadcast"
import type { RepoSuggestion } from "../shared/boards/sync-types"
import type { PackageUpdateManager } from "./package-update-manager"

export {
  assertSafeSkillId,
  assertSafeSkillSource,
  buildInstallSkillCommand,
  buildUninstallSkillCommand,
  getGlobalSkillLockPath,
  installSkill,
  listInstalledSkills,
  parseInstalledSkillsLock,
  searchSkills,
  uninstallSkill,
} from "./ws-router-skills"

export { resolveMcpTestBearer } from "./ws-router-settings"

export type { ClientState } from "./ws-router-utils"
export { isBenignStaleStateMessage } from "./ws-router-utils"

type RouteOutcome = "unclaimed" | "answered" | "silent"

interface CreateWsRouterArgs {
  store: EventStore
  diffStore?: Pick<DiffStore, "getSnapshot" | "refreshSnapshot" | "initializeGit" | "getGitHubPublishInfo" | "checkGitHubRepoAvailability" | "publishToGitHub" | "listBranches" | "previewMergeBranch" | "mergeBranch" | "syncBranch" | "checkoutBranch" | "createBranch" | "generateCommitMessage" | "commitFiles" | "discardFile" | "ignoreFile" | "readPatch">
  agent: AgentCoordinator
  terminals: TerminalManager
  keybindings: KeybindingsManager
  appSettings?: Pick<AppSettingsManager, "getSnapshot" | "write">
    & Partial<Pick<AppSettingsManager, "setCloudflareTunnel" | "setClaudeAuth" | "writePatch" | "onChange" | "createSubagent" | "updateSubagent" | "deleteSubagent">>
  analytics?: AnalyticsReporter
  tunnelGateway?: TunnelGateway
  llmProvider?: {
    read: () => Promise<LlmProviderSnapshot>
    write: (value: Pick<LlmProviderSnapshot, "provider" | "apiKey" | "model" | "baseUrl">) => Promise<LlmProviderSnapshot>
    validate: (value: Pick<LlmProviderSnapshot, "provider" | "apiKey" | "model" | "baseUrl">) => Promise<LlmProviderValidationResult>
  }
  listOpenRouterModels?: () => Promise<OpenRouterModel[]>
  refreshDiscovery: () => Promise<DiscoveredProject[]>
  getDiscoveredProjects: () => DiscoveredProject[]
  machineDisplayName: string
  updateManager: UpdateManager | null
  pushManager: PushManager
  workflowRegistry?: WorkflowRegistry
  boardRegistry?: BoardRegistry
  beaconRegistry?: BeaconRegistry
  boardSync?: BoardSync
  startWork?: (cardId: string) => Promise<StartWorkResult>
  startWorkView?: (cardId: string) => Promise<StartWorkView>
  cleanupView?: (cardId: string) => Promise<WorktreeCleanupView | null>
  resolveCleanup?: (cardId: string, decision: CleanupDecision) => Promise<WorktreeCleanupOutcome>
  suggestSyncRepos?: (boardId: string) => Promise<readonly RepoSuggestion[]>
  backgroundTaskOutputRegistry?: BackgroundTaskOutputRegistry
  liveBlocks?: LiveBlockHub
  subagentTranscriptRegistry?: SubagentTranscriptRegistry
  followedSessionRegistry?: FollowedSessionRegistry
  sessionShare?: SessionShareService
  packageUpdateManager?: PackageUpdateManager
  genuiDatasets?: GenUIDatasetService
  webhooks?: WebhookRegistry
  inbox?: InboxRegistry
  mcpSources?: McpSourcesTopic
  inboxReply?: InboxReplyAction
  inboxInstruct?: InboxReplyAction
  serviceBus?: Pick<ServiceBusController, "status" | "resetStore">
  authEnabled?: boolean
  plugins?: PluginsHostDep
}

export function createWsRouter({
  store,
  diffStore,
  agent,
  terminals,
  keybindings,
  appSettings,
  analytics,
  tunnelGateway,
  llmProvider,
  listOpenRouterModels,
  refreshDiscovery,
  getDiscoveredProjects,
  machineDisplayName,
  updateManager,
  pushManager,
  workflowRegistry,
  boardRegistry,
  beaconRegistry,
  boardSync,
  startWork,
  startWorkView,
  cleanupView,
  resolveCleanup,
  suggestSyncRepos,
  backgroundTaskOutputRegistry,
  liveBlocks,
  subagentTranscriptRegistry,
  followedSessionRegistry,
  sessionShare,
  packageUpdateManager,
  genuiDatasets,
  webhooks,
  inbox,
  mcpSources,
  inboxReply,
  inboxInstruct,
  serviceBus,
  authEnabled,
  plugins,
}: CreateWsRouterArgs) {
  const resolvedDiffStore = diffStore ?? buildFallbackDiffStore()
  const resolvedLlmProvider = llmProvider ?? buildFallbackLlmProvider()
  const resolvedAppSettings = buildResolvedAppSettings(appSettings)
  const resolvedAnalytics = analytics ?? NoopAnalyticsReporter

  const envelopeBuilder = createEnvelopeBuilder({
    store,
    agent,
    resolvedAppSettings,
    keybindings,
    resolvedDiffStore,
    workflowRegistry,
    boardRegistry,
    beaconRegistry,
    backgroundTaskOutputRegistry,
    followedSessionRegistry,
    webhooks,
    inbox,
    mcpSources,
    serviceBus,
    machineDisplayName,
    updateManager,
    packageUpdateManager,
    getDiscoveredProjects,
    terminals,
    pushManager,
  })

  const broadcast = new BroadcastManager({
    agent,
    store,
    terminals,
    keybindings,
    resolvedAppSettings,
    updateManager,
    packageUpdateManager,
    workflowRegistry,
    boardRegistry,
    beaconRegistry,
    backgroundTaskOutputRegistry,
    liveBlocks,
    envelopeBuilder,
  })
  const unsubscribeMcpSources = mcpSources?.onStatus(() => { broadcast.pushMcpSources() })

  function resolveChatRepoPath(chatId: string): string {
    const { chat, project } = resolveChatProject(chatId)
    return resolveSpawnPaths(chat, project.localPath).cwd
  }

  function resolveChatProject(chatId: string) {
    const chat = store.getChat(chatId)
    if (!chat) throw new Error("Chat not found")
    const project = store.getProject(chat.projectId)
    if (!project) throw new Error("Project not found")
    return { chat, project }
  }

  function buildChatDeps(ws: CommandConnection): ChatCommandDeps {
    return {
      store,
      agent,
      analytics: resolvedAnalytics,
      setDraftProtection: (chatIds) => { ws.data.protectedDraftChatIds = new Set(chatIds) },
      logSendProfilingFn: logSendToStartingProfile,
      send: (envelope) => send(ws, envelope),
      broadcastChatAndSidebar: (chatId) => broadcast.broadcastChatAndSidebar(chatId),
      broadcastSidebar: () => broadcast.broadcastFilteredSnapshots({ includeSidebar: true }),
      broadcastAll: () => broadcast.broadcastSnapshots(),
      followedSessionRegistry,
    }
  }

  function buildAgentCtrlDeps(ws: CommandConnection): AgentCtrlCommandDeps {
    return {
      agent,
      tunnelGateway,
      send: (envelope) => send(ws, envelope),
      broadcastChatAndSidebar: (chatId) => broadcast.broadcastChatAndSidebar(chatId),
    }
  }

  function buildMiscDeps(ws: CommandConnection): MiscCommandDeps {
    return {
      store,
      terminals,
      agent,
      sessionShare,
      analytics: resolvedAnalytics,
      listWorktrees,
      getOriginHost: () => ws.data.originHost ?? "",
      send: (envelope) => send(ws, envelope),
      broadcastSidebar: () => broadcast.broadcastFilteredSnapshots({ includeSidebar: true }),
      broadcastChatAndSidebar: (chatId) => broadcast.broadcastChatAndSidebar(chatId),
      pushTerminalSnapshot: (terminalId) => broadcast.pushTerminalSnapshot(terminalId),
    }
  }

  function sendBackgroundTaskOutput(
    ws: CommandConnection,
    command: Extract<ClientCommand, { type: "backgroundTasks.getOutput" }>,
    id: string,
  ): boolean {
    const output = backgroundTaskOutputRegistry?.getOutput(command.chatId, command.taskId)
    send(ws, {
      v: PROTOCOL_VERSION,
      type: "snapshot",
      id,
      snapshot: {
        type: "background-task-output",
        data: {
          chatId: command.chatId,
          taskId: command.taskId,
          content: output?.content ?? "",
          truncated: output?.truncated ?? false,
        },
      },
    })
    return true
  }

  async function routeCommand(
    connection: CommandConnection,
    received: ClientCommand,
    id: string,
  ): Promise<RouteOutcome> {
    let answered = false
    const ws: CommandConnection = {
      data: connection.data,
      send: (payload) => connection.send(payload),
      onSent: (envelope) => {
        if (envelope.id === id) answered = true
        connection.onSent?.(envelope)
      },
    }
    const command = stampCommandOrigin(received, ws.data.commandOrigin)
    const sendToClient = (envelope: ServerEnvelope) => send(ws, envelope)
    const handlers: readonly (() => Promise<boolean> | boolean)[] = [
      () => handleChatCommand(buildChatDeps(ws), command, id),
      () => handleMiscCommand(buildMiscDeps(ws), command, id),
      () => handleDiffCommand(
        {
          resolvedDiffStore,
          resolveChatRepoPath,
          send: sendToClient,
          broadcastSnapshots: () => broadcast.broadcastSnapshots(),
        },
        command,
        id,
      ),
      () => handleAgentCtrlCommand(buildAgentCtrlDeps(ws), command, id),
      () => handleSettingsCommand(
        {
          keybindings,
          resolvedAppSettings,
          resolvedAnalytics,
          resolvedLlmProvider,
          listOpenRouterModels,
          packageUpdateManager,
          beaconRegistry,
          authEnabled,
          send: sendToClient,
        },
        command,
        id,
      ),
      () => handleBoardCommand(
        {
          boardRegistry,
          boardSync,
          startWork,
          startWorkView,
          cleanupView,
          resolveCleanup,
          suggestSyncRepos,
          send: sendToClient,
          origin: ws.data.commandOrigin,
        },
        command,
        id,
      ),
      () => handleProjectCommand(
        {
          store,
          updateManager,
          diffStore: resolvedDiffStore,
          analytics: resolvedAnalytics,
          refreshDiscovery,
          ensureProjectDirectory,
          resolveLocalPath,
          importClaudeSessionsFn: () => importClaudeSessions({ store }),
          importSessionsByIdsFn: (sessionIds) => importSessionsByIds({
            store,
            sessionIds,
            onSessionImported: (info) => followedSessionRegistry?.consider(info),
          }),
          openExternalFn: openExternal,
          terminals,
          deleteChat: (chatId) => deleteChatWithTeardown(buildChatDeps(ws), chatId),
          boards: boardRegistry,
          shares: sessionShare,
          push: pushManager,
          removeWorktree: (repoRoot, worktreePath) => removeWorktree(repoRoot, worktreePath, { force: true }),
          removeProjectKannaFiles,
          send: sendToClient,
          broadcastSidebar: () => broadcast.broadcastFilteredSnapshots({ includeSidebar: true }),
        },
        command,
        id,
      ),
      () => handleProjectPathsCommand(store, listProjectPaths, sendToClient, command, id),
      () => handleUploadDeleteCommand(store, deleteProjectUpload, sendToClient, command, id),
      () => handlePluginsCommand(plugins, sendToClient, command, id),
      () => handlePushCommand(
        {
          pushManager,
          getPushDeviceId: () => ws.data.pushDeviceId,
          setPushDeviceId: (did) => { ws.data.pushDeviceId = did },
          send: sendToClient,
          broadcastPushConfig: () => broadcast.broadcastFilteredSnapshots({ includePushConfig: true }),
        },
        command,
        id,
      ),
      () => handleObservabilityCommand(
        { workflowRegistry, subagentTranscriptRegistry, store, send: sendToClient },
        command,
        id,
      ),
      () => command.type === "backgroundTasks.getOutput" && sendBackgroundTaskOutput(ws, command, id),
      () => handleGenUICommand(genuiDatasets, sendToClient, command, id),
      () => handleInboxCommand(inbox, inboxReply, inboxInstruct, sendToClient, command, id),
      () => handleServiceBusCommand(serviceBus, sendToClient, command, id),
      () => handleWebhooksCommand(
        webhooks,
        sendToClient,
        command,
        id,
        () => providerCatalogOf(catalogSourcesOf(resolvedAppSettings.getSnapshot())),
      ),
    ]
    for (const runHandler of handlers) {
      if (await runHandler()) return answered ? "answered" : "silent"
    }
    return "unclaimed"
  }

  function routingFailure(outcome: "unclaimed" | "silent", command: ClientCommand, id: string): ServerEnvelope {
    log.error(
      outcome === "unclaimed" ? "[ws-router] no handler claimed command" : "[ws-router] handler claimed command but sent no reply",
      { id, type: command.type },
    )
    const message = outcome === "unclaimed" ? unhandledCommandMessage(command.type) : silentCommandMessage(command.type)
    return { v: PROTOCOL_VERSION, type: "error", id, message }
  }

  async function handleCommand(ws: CommandConnection, message: Extract<ClientEnvelope, { type: "command" }>) {
    const { command, id } = message
    try {
      const outcome = await routeCommand(ws, command, id)
      if (outcome !== "answered") send(ws, routingFailure(outcome, command, id))
    } catch (error) {
      send(ws, describeCommandFailure(command, id, error instanceof Error ? error : String(error)))
    }
  }

  function rejectInvalidCommand(ws: CommandConnection, id: string, error: string) {
    log.warn("[ws-router] invalid command rejected", { id, message: error })
    send(ws, { v: PROTOCOL_VERSION, type: "error", id, message: error })
  }

  function describeCommandFailure(command: ClientCommand, id: string, error: Error | string): ServerEnvelope {
    const messageText = error instanceof Error ? error.message : String(error)
    const benign = isBenignStaleStateMessage(messageText)
    const logFn = benign ? log.info : log.error
    logFn("[ws-router] command failed", {
      id,
      type: command.type,
      message: messageText,
    })
    return { v: PROTOCOL_VERSION, type: "error", id, message: messageText }
  }

  async function dispatchCommand(candidate: ClientCommand, origin?: CommandOrigin): Promise<ServerEnvelope> {
    const id = randomUUID()
    const validated = parseClientCommand(safeJsonParse(JSON.stringify(candidate)) ?? null)
    if (!validated.ok) {
      log.warn("[ws-router] invalid command rejected", { id, message: validated.error })
      return { v: PROTOCOL_VERSION, type: "error", id, message: validated.error }
    }
    const command = validated.command
    const captured: ServerEnvelope[] = []
    const connection: CommandConnection = {
      data: { subscriptions: new Map(), snapshotSignatures: new Map(), originHost: "", commandOrigin: origin },
      send(payload) {
        const parsed: JsonValue | null = safeJsonParse(payload)
        if (parsed !== null && isServerEnvelope(parsed)) captured.push(parsed)
        return payload.length
      },
    }
    try {
      const outcome = await routeCommand(connection, command, id)
      if (outcome !== "answered") return routingFailure(outcome, command, id)
    } catch (error) {
      return describeCommandFailure(command, id, error instanceof Error ? error : String(error))
    }
    const answer = captured.find((envelope) => envelope.id === id)
    return answer ?? routingFailure("silent", command, id)
  }

  function readSnapshot(topic: SubscriptionTopic): ServerEnvelope {
    return envelopeBuilder.createEnvelope(randomUUID(), topic)
  }

  return {
    dispatchCommand,
    readSnapshot,
    handleOpen(ws: ServerWebSocket<ClientState>) {
      broadcast.addSocket(ws)
    },
    handleClose(ws: ServerWebSocket<ClientState>) {
      if (ws.data.pushDeviceId) {
        pushManager.clearFocus(ws.data.pushDeviceId)
      }
      for (const dispose of ws.data.backgroundTaskWatchers?.values() ?? []) {
        dispose()
      }
      broadcast.removeSocket(ws)
    },
    broadcastSnapshots: () => broadcast.broadcastSnapshots(),
    broadcastChatStateImmediately: (chatId: string) => broadcast.broadcastChatStateImmediately(chatId),
    scheduleBroadcast: () => broadcast.scheduleBroadcast(),
    scheduleChatStateBroadcast: (chatId: string) => broadcast.scheduleChatStateBroadcast(chatId),
    pruneStaleEmptyChats: () => broadcast.maybePruneStaleEmptyChats(),
    pushFollowedSessions: () => broadcast.pushFollowedSessions(),
    pushCronJobs: () => broadcast.pushCronJobs(),
    pushWebhooks: () => broadcast.pushWebhooks(),
    pushInbox: () => broadcast.pushInbox(),
    pushServiceBus: () => broadcast.pushServiceBus(),
    async handleMessage(ws: ServerWebSocket<ClientState>, raw: string | Buffer | ArrayBuffer | Uint8Array) {
      const parsed: JsonValue | null = safeJsonParse(String(raw))
      if (parsed === null) {
        send(ws, { v: PROTOCOL_VERSION, type: "error", message: "Invalid JSON" })
        return
      }

      const rawEnvelope: JsonValue = parsed
      if (!isClientEnvelope(parsed)) {
        send(ws, { v: PROTOCOL_VERSION, type: "error", message: "Invalid envelope" })
        return
      }

      if (parsed.type === "subscribe") {
        const snapshotSignatures = ensureSnapshotSignatures(ws)
        ws.data.subscriptions.set(parsed.id, parsed.topic)
        snapshotSignatures.delete(parsed.id)
        if (parsed.topic.type === "background-task-output") {
          const dispose = backgroundTaskOutputRegistry?.addWatcher(parsed.topic.chatId, parsed.topic.taskId)
          if (dispose) {
            ws.data.backgroundTaskWatchers ??= new Map()
            ws.data.backgroundTaskWatchers.set(parsed.id, dispose)
          }
        }
        if (parsed.topic.type === "local-projects") {
          void refreshDiscovery().then(() => {
            if (ws.data.subscriptions.has(parsed.id)) {
              void broadcast.pushSnapshots(ws, { skipPrune: true })
            }
          })
          return
        }
        await broadcast.pushSnapshots(ws, { skipPrune: true })
        if (parsed.topic.type === "chat") broadcast.pushLatestLiveBlock(ws, parsed.id, parsed.topic.chatId)
        return
      }

      if (parsed.type === "unsubscribe") {
        const snapshotSignatures = ensureSnapshotSignatures(ws)
        ws.data.subscriptions.delete(parsed.id)
        snapshotSignatures.delete(parsed.id)
        ws.data.chatOpSeqBySubId?.delete(parsed.id)
        const disposeWatcher = ws.data.backgroundTaskWatchers?.get(parsed.id)
        if (disposeWatcher) {
          disposeWatcher()
          ws.data.backgroundTaskWatchers!.delete(parsed.id)
        }
        send(ws, { v: PROTOCOL_VERSION, type: "ack", id: parsed.id })
        return
      }

      const validated = parseClientCommand(isJsonObject(rawEnvelope) ? rawEnvelope.command : null)
      if (!validated.ok) {
        rejectInvalidCommand(ws, parsed.id, validated.error)
        return
      }
      await handleCommand(ws, { v: PROTOCOL_VERSION, type: "command", id: parsed.id, command: validated.command })
    },
    async dispose() {
      broadcast.dispose()
      unsubscribeMcpSources?.()
      await mcpSources?.stop()
    },
  }
}
