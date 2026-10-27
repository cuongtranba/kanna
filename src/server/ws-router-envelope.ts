import os from "node:os"
import { log } from "../shared/log"
import { PROTOCOL_VERSION } from "../shared/types"
import type { ChatSnapshot } from "../shared/types"
import type { ServerEnvelope, ServerSnapshot, SubscriptionTopic } from "../shared/protocol"
import type { ServerWebSocket } from "bun"
import { catalogSourcesOf, deriveChatSnapshot, deriveLocalProjectsSnapshot, deriveSidebarData, type ChatRuntimeView } from "./read-models"
import { deriveCronJobs } from "./cron/read-model"
import type { CronJobsGlobalRow } from "../shared/cron/types"
import { localCommandsForCwd } from "./claude-slash-commands"
import { resolveChatCwd } from "./claude-session-config"
import type { EventStore } from "./event-store"
import type { AgentCoordinator } from "./agent"
import type { TerminalManager } from "./terminal-manager"
import type { KeybindingsManager } from "./keybindings"
import type { WorkflowRegistry } from "./workflow-registry"
import type { BackgroundTaskOutputRegistry } from "./background-task-output-registry"
import type { BoardRegistry } from "./board-registry"
import type { BeaconRegistry } from "./beacon-registry"
import { buildBeaconStatusRows } from "../shared/beacon-status"
import { chatHasPendingWork } from "../shared/chat-activity"
import type { FollowedSessionRegistry } from "./followed-session-registry"
import type { InboxRegistry } from "./inbox/inbox-registry"
import type { McpSourcesTopic } from "./mcp-sources/mcp-sources-boot"
import type { WebhookRegistry } from "./webhooks/webhook-registry"
import type { ServiceBusController } from "./service-bus/service-bus-boot"
import { DISABLED_SERVICE_BUS_STATUS } from "../shared/service-bus/jetstream-config"
import { idleUpdateSnapshot, type UpdateManager } from "./update-manager"
import type { PackageUpdateManager } from "./package-update-manager"
import type { PushManager } from "./push/push-manager"
import type { DiffStore } from "./diff-store"
import type { DiscoveredProject } from "./discovery.adapter"
import { isSendToStartingProfilingEnabled } from "./ws-router-utils"
import type { ClientState, SnapshotComputationCache } from "./ws-router-utils"
import type { ResolvedAppSettings } from "./ws-router-defaults"

const DEFAULT_CHAT_RECENT_LIMIT = 200

const MAX_BOARD_PAGE_SIZE = 500

function resolveTopicRepoPath(
  store: EventStore,
  projectId: string,
  chatId: string | undefined,
): string | null {
  const project = store.getProject(projectId)
  if (!project) return null
  if (chatId === undefined) return project.localPath
  return resolveChatCwd(store, chatId) ?? null
}

export function resolveBoardPageSize(requested: number | undefined): number | undefined {
  if (requested === undefined) return undefined
  if (!Number.isInteger(requested) || requested <= 0) return undefined
  return Math.min(requested, MAX_BOARD_PAGE_SIZE)
}


export interface EnvelopeDeps {
  store: EventStore
  agent: AgentCoordinator
  resolvedAppSettings: ResolvedAppSettings
  keybindings: KeybindingsManager
  resolvedDiffStore: Pick<DiffStore, "getSnapshot">
  workflowRegistry?: WorkflowRegistry
  backgroundTaskOutputRegistry?: BackgroundTaskOutputRegistry
  boardRegistry?: BoardRegistry
  beaconRegistry?: BeaconRegistry
  followedSessionRegistry?: FollowedSessionRegistry
  webhooks?: WebhookRegistry
  inbox?: InboxRegistry
  mcpSources?: McpSourcesTopic
  serviceBus?: Pick<ServiceBusController, "status">
  machineDisplayName: string
  updateManager: UpdateManager | null
  packageUpdateManager?: PackageUpdateManager
  getDiscoveredProjects: () => DiscoveredProject[]
  terminals: TerminalManager
  pushManager: PushManager
}


function chatRuntimeViewOf(agent: AgentCoordinator): ChatRuntimeView {
  return {
    activeStatuses: agent.getActiveStatuses(),
    drainingChatIds: agent.getDrainingChatIds(),
    waitStartedAtByChatId: agent.getWaitStartedAtByChatId(),
    claudeSessionStates: agent.getClaudeSessionStates?.() ?? new Map(),
    backgroundTasksByChatId: agent.getBackgroundTasksByChatId?.() ?? new Map(),
    nowMs: Date.now(),
  }
}

function buildSidebarSnapshotCacheEntry(
  deps: EnvelopeDeps,
  cache?: SnapshotComputationCache
): NonNullable<SnapshotComputationCache["sidebar"]> {
  if (cache?.sidebar) {
    return cache.sidebar
  }

  const { store, agent, pushManager, workflowRegistry } = deps
  const startedAt = performance.now()
  const discoveredProvidersByPath = new Map(
    deps.getDiscoveredProjects().map((p) => [p.localPath, p.discoveredByProviders])
  )
  const data = deriveSidebarData(store.state, chatRuntimeViewOf(agent), {
    sidebarProjectOrder: store.getSidebarProjectOrder(),
    discoveredProvidersByPath,
    workflowRegistry,
  })
  const observed = data.projectGroups.flatMap((group) =>
    group.chats.map((chat) => ({
      chatId: chat.chatId,
      projectLocalPath: group.localPath,
      projectTitle: group.localPath.split("/").filter(Boolean).pop() ?? group.localPath,
      chatTitle: chat.title,
      status: chat.status,
      hasPendingWork: chatHasPendingWork(chat.activity),
    }))
  )
  void pushManager.observeStatuses(observed).catch((error) => {
    log.warn("[kanna/push] observeStatuses failed", { error })
  })
  if (isSendToStartingProfilingEnabled()) {
    const totalChats = data.projectGroups.reduce((count, group) => count + group.chats.length, 0)
    log.info("[kanna/send->starting][server]", JSON.stringify({
      stage: "ws.sidebar_snapshot_built",
      elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
      projectGroupCount: data.projectGroups.length,
      chatCount: totalChats,
      totalChatCount: store.state.chatsById.size,
      totalProjectCount: store.state.projectsById.size,
    }))
  }

  const sidebar = {
    data,
    signature: JSON.stringify({
      type: "sidebar" as const,
      data,
    }),
  }

  if (cache) {
    cache.sidebar = sidebar
  }

  return sidebar
}


export interface EnvelopeBuilder {
  getSidebarSnapshotCacheEntry(cache?: SnapshotComputationCache): NonNullable<SnapshotComputationCache["sidebar"]>
  createEnvelope(
    id: string,
    topic: SubscriptionTopic,
    cache?: SnapshotComputationCache,
    connection?: ServerWebSocket<ClientState>,
  ): ServerEnvelope
  deriveChatMeta(chatId: string): ChatSnapshot | null
}

export function createEnvelopeBuilder(deps: EnvelopeDeps): EnvelopeBuilder {
  const {
    store,
    agent,
    resolvedAppSettings,
    keybindings,
    resolvedDiffStore,
    workflowRegistry,
    backgroundTaskOutputRegistry,
    boardRegistry,
    beaconRegistry,
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
  } = deps

  function getSidebarSnapshotCacheEntry(cache?: SnapshotComputationCache) {
    return buildSidebarSnapshotCacheEntry(deps, cache)
  }

  function deriveChat(chatId: string, recentLimit: number): ChatSnapshot | null {
    return deriveChatSnapshot(
      store.state,
      chatId,
      {
        getMessages: (id) => store.getRecentChatHistory(id, recentLimit),
        getTunnelEvents: (id) => store.getTunnelEvents(id),
        catalogSources: catalogSourcesOf(resolvedAppSettings.getSnapshot()),
      },
      chatRuntimeViewOf(agent),
    )
  }

  function deriveChatMeta(chatId: string): ChatSnapshot | null {
    return deriveChat(chatId, 0)
  }

  function snapshotFor(
    topic: SubscriptionTopic,
    cache?: SnapshotComputationCache,
    connection?: ServerWebSocket<ClientState>,
  ): ServerSnapshot {
    switch (topic.type) {
      case "sidebar":
        return { type: "sidebar", data: getSidebarSnapshotCacheEntry(cache).data }
      case "local-projects":
        return {
          type: "local-projects",
          data: deriveLocalProjectsSnapshot(store.state, getDiscoveredProjects(), machineDisplayName, os.homedir()),
        }
      case "keybindings":
        return { type: "keybindings", data: keybindings.getSnapshot() }
      case "app-settings":
        return { type: "app-settings", data: resolvedAppSettings.getSnapshot() }
      case "push-config":
        return { type: "push-config", data: pushManager.getConfigSnapshot(connection?.data.pushDeviceId ?? null) }
      case "update":
        return { type: "update", data: updateManager?.getSnapshot() ?? idleUpdateSnapshot("unknown") }
      case "terminal":
        return { type: "terminal", data: terminals.getSnapshot(topic.terminalId) }
      case "project-git": {
        const repoPath = resolveTopicRepoPath(store, topic.projectId, topic.chatId)
        return { type: "project-git", data: repoPath === null ? null : resolvedDiffStore.getSnapshot(repoPath) }
      }
      case "project-commands": {
        const project = store.getProject(topic.projectId)
        return {
          type: "project-commands",
          data: {
            projectId: topic.projectId,
            commands: project
              ? localCommandsForCwd({ localCatalog: agent.localCatalog }, project.localPath)
              : [],
          },
        }
      }
      case "workflows":
        return { type: "workflows", data: { chatId: topic.chatId, runs: workflowRegistry?.snapshot(topic.chatId) ?? [] } }
      case "background-task-output": {
        const output = backgroundTaskOutputRegistry?.getOutput(topic.chatId, topic.taskId)
        return {
          type: "background-task-output",
          data: {
            chatId: topic.chatId,
            taskId: topic.taskId,
            content: output?.content ?? "",
            truncated: output?.truncated ?? false,
          },
        }
      }
      case "boards":
        return {
          type: "boards",
          data: {
            ownerKind: topic.ownerKind,
            ownerId: topic.ownerId,
            boards: boardRegistry?.listBoards({ kind: topic.ownerKind, id: topic.ownerId }) ?? [],
          },
        }
      case "board":
        return {
          type: "board",
          data: {
            boardId: topic.boardId,
            view: boardRegistry?.boardView(topic.boardId, resolveBoardPageSize(topic.pageSize)) ?? null,
          },
        }
      case "followed-sessions":
        return { type: "followed-sessions", data: { chatIds: followedSessionRegistry?.followedChatIds() ?? [] } }
      case "cron-jobs":
        return { type: "cron-jobs", data: { rows: buildCronJobsGlobalRows(store) } }
      case "webhooks":
        return { type: "webhooks", data: webhooks?.snapshot() ?? { hooks: [] } }
      case "inbox":
        return { type: "inbox", data: inbox?.snapshot() ?? { threads: [], items: [], unreadCount: 0, total: 0 } }
      case "mcp-sources":
        return { type: "mcp-sources", data: mcpSources?.snapshot() ?? { sources: [] } }
      case "service-bus":
        return { type: "service-bus", data: serviceBus?.status() ?? DISABLED_SERVICE_BUS_STATUS }
      case "beacons":
        return {
          type: "beacons",
          data: {
            beacons: buildBeaconStatusRows(
              resolvedAppSettings.getSnapshot().customBeacons,
              beaconRegistry?.live() ?? [],
            ),
          },
        }
      case "package-updates":
        return {
          type: "package-updates",
          data: packageUpdateManager?.getSnapshot() ?? {
            status: "idle",
            packages: [],
            lastCheckedAt: null,
            error: null,
            applying: [],
            autoApplyHistory: [],
          },
        }
      case "chat": {
        const seq = store.chatOps.currentSeq(topic.chatId)
        const data = deriveChat(topic.chatId, topic.recentLimit ?? DEFAULT_CHAT_RECENT_LIMIT)
        return { type: "chat", data: data && seq !== undefined ? { ...data, seq } : data }
      }
    }
  }

  function createEnvelope(
    id: string,
    topic: SubscriptionTopic,
    cache?: SnapshotComputationCache,
    connection?: ServerWebSocket<ClientState>,
  ): ServerEnvelope {
    return { v: PROTOCOL_VERSION, type: "snapshot", id, snapshot: snapshotFor(topic, cache, connection) }
  }

  return { getSidebarSnapshotCacheEntry, createEnvelope, deriveChatMeta }
}

function buildCronJobsGlobalRows(store: EventStore): CronJobsGlobalRow[] {
  const now = Date.now()
  const rows: CronJobsGlobalRow[] = []
  for (const chatId of store.listAutoContinueChats()) {
    const chat = store.getChat(chatId)
    if (!chat) continue
    const project = store.getProject(chat.projectId)
    if (!project) continue
    for (const job of deriveCronJobs(store.getAutoContinueEvents(chatId), chatId, now)) {
      rows.push({
        projectId: project.id,
        projectPath: project.localPath,
        chatId,
        chatTitle: chat.title,
        job,
      })
    }
  }
  rows.sort((a, b) => a.projectPath.localeCompare(b.projectPath) || a.job.armedAt - b.job.armedAt)
  return rows
}
