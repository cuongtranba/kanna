import type { AnyValue } from "../shared/errors"
import { log } from "../shared/log"
import type { ServerWebSocket } from "bun"
import { PROTOCOL_VERSION } from "../shared/types"
import type { ClientEnvelope } from "../shared/protocol"
import { isClientEnvelope } from "../shared/protocol"
import type { AgentCoordinator } from "./agent"
import type { AnalyticsReporter } from "./analytics"
import { NoopAnalyticsReporter } from "./analytics"
import type { AppSettingsManager } from "./app-settings"
import type { DiscoveredProject } from "./discovery.adapter"
import { DiffStore } from "./diff-store"
import { EventStore } from "./event-store"
import { openExternal } from "./external-open"
import { KeybindingsManager } from "./keybindings"
import { resolveLocalPath } from "./paths"
import { ensureProjectDirectory } from "./project-directory.adapter"
import { TerminalManager } from "./terminal-manager"
import type { UpdateManager } from "./update-manager"
import type {
  LlmProviderSnapshot,
  LlmProviderValidationResult,
  OpenRouterModel,
} from "../shared/types"
import { importClaudeSessions } from "./claude-session-importer.adapter"
import { listWorktrees } from "./worktree-store.adapter"
import type { TunnelGateway } from "./cloudflare-tunnel/gateway"
import type { PushManager } from "./push/push-manager"
import type { SessionShareService } from "./session-share"
import type { PtyInstanceRegistry } from "./claude-pty/pty-instance-registry"
import type { WorkflowRegistry } from "./workflow-registry"
import type { SubagentTranscriptRegistry } from "./subagent-transcript-registry"
import { buildFallbackDiffStore, buildFallbackLlmProvider, buildResolvedAppSettings } from "./ws-router-defaults"
import { handleSettingsCommand } from "./ws-router-settings"
import { handleDiffCommand } from "./ws-router-diff"
import { handleOrchCommand } from "./ws-router-orch"
import { handleAgentCtrlCommand } from "./ws-router-agent-ctrl"
import { handlePushCommand } from "./ws-router-push"
import { handleMiscCommand } from "./ws-router-misc"
import { handleProjectCommand } from "./ws-router-project"
import { handleChatCommand } from "./ws-router-chat"
import {
  ensureSnapshotSignatures,
  isBenignStaleStateMessage,
  logSendToStartingProfile,
  send,
} from "./ws-router-utils"
import type { ClientState } from "./ws-router-utils"
import { createEnvelopeBuilder } from "./ws-router-envelope"
import { BroadcastManager } from "./ws-router-broadcast"

// Re-export skill utilities so existing callers (tests, server.ts, etc.) keep working.
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

// Re-export settings helpers that tests import from this module.
export { resolveMcpTestBearer } from "./ws-router-settings"

// Re-export for backwards compatibility — callers import these from ws-router.
export type { ClientState } from "./ws-router-utils"
export { isBenignStaleStateMessage } from "./ws-router-utils"

interface CreateWsRouterArgs {
  store: EventStore
  diffStore?: Pick<DiffStore, "getProjectSnapshot" | "refreshSnapshot" | "initializeGit" | "getGitHubPublishInfo" | "checkGitHubRepoAvailability" | "publishToGitHub" | "listBranches" | "previewMergeBranch" | "mergeBranch" | "syncBranch" | "checkoutBranch" | "createBranch" | "generateCommitMessage" | "commitFiles" | "discardFile" | "ignoreFile" | "readPatch">
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
  ptyInstances?: PtyInstanceRegistry
  killPtyInstance?: (chatId: string) => Promise<{ ok: boolean; error?: string }>
  workflowRegistry?: WorkflowRegistry
  subagentTranscriptRegistry?: SubagentTranscriptRegistry
  sessionShare?: SessionShareService
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
  ptyInstances,
  killPtyInstance,
  workflowRegistry,
  subagentTranscriptRegistry,
  sessionShare,
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
    ptyInstances,
    workflowRegistry,
    machineDisplayName,
    updateManager,
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
    ptyInstances,
    workflowRegistry,
    envelopeBuilder,
  })

  function resolveChatProject(chatId: string) {
    const chat = store.getChat(chatId)
    if (!chat) throw new Error("Chat not found")
    const project = store.getProject(chat.projectId)
    if (!project) throw new Error("Project not found")
    return { chat, project }
  }

  async function handleCommand(ws: ServerWebSocket<ClientState>, message: Extract<ClientEnvelope, { type: "command" }>) {
    const { command, id } = message
    try {
      switch (command.type) {
        case "settings.readKeybindings":
        case "settings.writeKeybindings":
        case "settings.readAppSettings":
        case "settings.writeAppSettings":
        case "appSettings.setCloudflareTunnel":
        case "appSettings.setClaudeAuth":
        case "appSettings.testOAuthToken":
        case "settings.writeAppSettingsPatch":
        case "subagent.create":
        case "subagent.update":
        case "subagent.delete":
        case "settings.testMcpServer":
        case "settings.startMcpOAuth":
        case "settings.completeMcpOAuth":
        case "settings.readLlmProvider":
        case "settings.listOpenRouterModels":
        case "settings.getChangelog":
        case "settings.writeLlmProvider":
        case "settings.validateLlmProvider":
        case "skills.search":
        case "skills.install":
        case "skills.uninstall":
        case "skills.listInstalled": {
          await handleSettingsCommand(
            {
              keybindings,
              resolvedAppSettings,
              resolvedAnalytics,
              resolvedLlmProvider,
              listOpenRouterModels,
              send: (envelope) => send(ws, envelope),
            },
            command,
            id,
          )
          return
        }
        case "chat.create":
        case "chat.fork":
        case "chat.rename":
        case "chat.archive":
        case "chat.unarchive":
        case "chat.delete": {
          await handleChatCommand(
            {
              store,
              agent,
              analytics: resolvedAnalytics,
              setDraftProtection: (chatIds) => { ws.data.protectedDraftChatIds = new Set(chatIds) },
              logSendProfilingFn: logSendToStartingProfile,
              send: (envelope) => send(ws, envelope),
              broadcastChatAndSidebar: (chatId) => broadcast.broadcastChatAndSidebar(chatId),
              broadcastSidebar: () => broadcast.broadcastFilteredSnapshots({ includeSidebar: true }),
              broadcastAll: () => broadcast.broadcastSnapshots(),
            },
            command,
            id,
          )
          return
        }
        case "autoContinue.accept":
        case "autoContinue.reschedule":
        case "autoContinue.cancel":
        case "tunnel.accept":
        case "tunnel.stop":
        case "tunnel.retry": {
          await handleAgentCtrlCommand(
            {
              agent,
              tunnelGateway,
              killPtyInstance,
              send: (envelope) => send(ws, envelope),
              broadcastChatAndSidebar: (chatId) => broadcast.broadcastChatAndSidebar(chatId),
            },
            command,
            id,
          )
          return
        }
        case "chat.markRead":
        case "chat.setPolicyOverride":
        case "chat.setDraftProtection":
        case "chat.send": {
          await handleChatCommand(
            {
              store,
              agent,
              analytics: resolvedAnalytics,
              setDraftProtection: (chatIds) => { ws.data.protectedDraftChatIds = new Set(chatIds) },
              logSendProfilingFn: logSendToStartingProfile,
              send: (envelope) => send(ws, envelope),
              broadcastChatAndSidebar: (chatId) => broadcast.broadcastChatAndSidebar(chatId),
              broadcastSidebar: () => broadcast.broadcastFilteredSnapshots({ includeSidebar: true }),
              broadcastAll: () => broadcast.broadcastSnapshots(),
            },
            command,
            id,
          )
          return
        }
        case "chat.refreshDiffs":
        case "chat.initGit":
        case "chat.getGitHubPublishInfo":
        case "chat.checkGitHubRepoAvailability":
        case "chat.publishToGitHub":
        case "chat.listBranches":
        case "chat.previewMergeBranch":
        case "chat.mergeBranch":
        case "chat.checkoutBranch":
        case "chat.syncBranch":
        case "chat.createBranch":
        case "chat.generateCommitMessage":
        case "chat.commitDiffs":
        case "chat.discardDiffFile":
        case "chat.ignoreDiffFile": {
          await handleDiffCommand(
            {
              resolvedDiffStore,
              resolveChatProject,
              send: (envelope) => send(ws, envelope),
              broadcastSnapshots: () => broadcast.broadcastSnapshots(),
            },
            command,
            id,
          )
          return
        }
        case "chat.cancel":
        case "chat.stopDraining":
        case "chat.loadHistory":
        case "chat.respondTool":
        case "chat.toolRequestAnswer":
        case "chat.respondSubagentTool":
        case "chat.cancelSubagentRun": {
          await handleChatCommand(
            {
              store,
              agent,
              analytics: resolvedAnalytics,
              setDraftProtection: (chatIds) => { ws.data.protectedDraftChatIds = new Set(chatIds) },
              logSendProfilingFn: logSendToStartingProfile,
              send: (envelope) => send(ws, envelope),
              broadcastChatAndSidebar: (chatId) => broadcast.broadcastChatAndSidebar(chatId),
              broadcastSidebar: () => broadcast.broadcastFilteredSnapshots({ includeSidebar: true }),
              broadcastAll: () => broadcast.broadcastSnapshots(),
            },
            command,
            id,
          )
          return
        }
        case "message.enqueue":
        case "message.steer":
        case "message.dequeue":
        case "terminal.create":
        case "terminal.input":
        case "terminal.resize":
        case "terminal.close": {
          await handleMiscCommand(
            {
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
            },
            command,
            id,
          )
          return
        }
        case "push.identifyDevice":
        case "push.subscribe":
        case "push.unsubscribe":
        case "push.test":
        case "push.setProjectMute":
        case "push.setFocusedChat": {
          await handlePushCommand(
            {
              pushManager,
              getPushDeviceId: () => ws.data.pushDeviceId,
              setPushDeviceId: (did) => { ws.data.pushDeviceId = did },
              send: (envelope) => send(ws, envelope),
              broadcastPushConfig: () => broadcast.broadcastFilteredSnapshots({ includePushConfig: true }),
            },
            command,
            id,
          )
          return
        }
        case "pty.cancel":
        case "pty.kill": {
          await handleAgentCtrlCommand(
            {
              agent,
              tunnelGateway,
              killPtyInstance,
              send: (envelope) => send(ws, envelope),
              broadcastChatAndSidebar: (chatId) => broadcast.broadcastChatAndSidebar(chatId),
            },
            command,
            id,
          )
          return
        }
        case "stack.create":
        case "stack.rename":
        case "stack.remove":
        case "stack.addProject":
        case "stack.removeProject":
        case "stack.listWorktrees":
        case "share.mint":
        case "share.revoke":
        case "share.list": {
          await handleMiscCommand(
            {
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
            },
            command,
            id,
          )
          return
        }
        case "workflows.getRun":
        case "workflows.getAgentTranscript":
        case "subagents.getRun":
        case "orch.run":
        case "orch.cancelRun":
        case "orch.getRun": {
          await handleOrchCommand(
            {
              agent,
              workflowRegistry,
              subagentTranscriptRegistry,
              send: (envelope) => send(ws, envelope),
            },
            command,
            id,
          )
          return
        }
        case "system.ping":
        case "system.openExternal":
        case "update.check":
        case "update.install":
        case "update.reload":
        case "project.open":
        case "project.create":
        case "project.remove":
        case "project.setStar":
        case "project.readDiffPatch":
        case "sessions.importClaude":
        case "sidebar.reorderProjectGroups": {
          await handleProjectCommand(
            {
              store,
              updateManager,
              diffStore: resolvedDiffStore,
              analytics: resolvedAnalytics,
              refreshDiscovery,
              ensureProjectDirectory,
              resolveLocalPath,
              importClaudeSessionsFn: () => importClaudeSessions({ store }),
              openExternalFn: openExternal,
              terminals,
              send: (envelope) => send(ws, envelope),
              broadcastSidebar: () => broadcast.broadcastFilteredSnapshots({ includeSidebar: true }),
            },
            command,
            id,
          )
          return
        }
      }

      await broadcast.broadcastSnapshots()
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      const benign = isBenignStaleStateMessage(messageText)
      const logFn = benign ? log.info : log.error
      logFn("[ws-router] command failed", {
        id,
        type: command.type,
        message: messageText,
      })
      send(ws, { v: PROTOCOL_VERSION, type: "error", id, message: messageText })
    }
  }

  return {
    handleOpen(ws: ServerWebSocket<ClientState>) {
      broadcast.addSocket(ws)
    },
    handleClose(ws: ServerWebSocket<ClientState>) {
      if (ws.data.pushDeviceId) {
        pushManager.clearFocus(ws.data.pushDeviceId)
      }
      broadcast.removeSocket(ws)
    },
    broadcastSnapshots: () => broadcast.broadcastSnapshots(),
    broadcastChatStateImmediately: (chatId: string) => broadcast.broadcastChatStateImmediately(chatId),
    scheduleBroadcast: () => broadcast.scheduleBroadcast(),
    scheduleChatStateBroadcast: (chatId: string) => broadcast.scheduleChatStateBroadcast(chatId),
    pruneStaleEmptyChats: () => broadcast.maybePruneStaleEmptyChats(),
    async handleMessage(ws: ServerWebSocket<ClientState>, raw: string | Buffer | ArrayBuffer | Uint8Array) {
      let parsed: AnyValue
      try {
        parsed = JSON.parse(String(raw))
      } catch {
        send(ws, { v: PROTOCOL_VERSION, type: "error", message: "Invalid JSON" })
        return
      }

      if (!isClientEnvelope(parsed)) {
        send(ws, { v: PROTOCOL_VERSION, type: "error", message: "Invalid envelope" })
        return
      }

      if (parsed.type === "subscribe") {
        const snapshotSignatures = ensureSnapshotSignatures(ws)
        ws.data.subscriptions.set(parsed.id, parsed.topic)
        snapshotSignatures.delete(parsed.id)
        if (parsed.topic.type === "chat") {
          void agent.ensureSlashCommandsLoaded(parsed.topic.chatId)
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
        return
      }

      if (parsed.type === "unsubscribe") {
        const snapshotSignatures = ensureSnapshotSignatures(ws)
        ws.data.subscriptions.delete(parsed.id)
        snapshotSignatures.delete(parsed.id)
        ws.data.chatOpSeqBySubId?.delete(parsed.id)
        send(ws, { v: PROTOCOL_VERSION, type: "ack", id: parsed.id })
        return
      }

      await handleCommand(ws, parsed)
    },
    dispose() {
      broadcast.dispose()
    },
  }
}
