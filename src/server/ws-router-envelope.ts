import os from "node:os"
import { log } from "../shared/log"
import { PROTOCOL_VERSION } from "../shared/types"
import type { ChatSnapshot } from "../shared/types"
import type { ServerEnvelope, SubscriptionTopic } from "../shared/protocol"
import type { ServerWebSocket } from "bun"
import { deriveChatSnapshot, deriveLocalProjectsSnapshot, deriveSidebarData } from "./read-models"
import { deriveCronJobs } from "./cron/read-model"
import type { CronJobsGlobalRow } from "../shared/cron/types"
import { localCommandsForCwd } from "./claude-slash-commands"
import { resolveSpawnPaths } from "./claude-session-config"
import type { EventStore } from "./event-store"
import type { AgentCoordinator } from "./agent"
import type { TerminalManager } from "./terminal-manager"
import type { KeybindingsManager } from "./keybindings"
import type { PtyInstanceRegistry } from "./claude-pty/pty-instance-registry"
import type { WorkflowRegistry } from "./workflow-registry"
import type { BackgroundTaskOutputRegistry } from "./background-task-output-registry"
import type { BoardRegistry } from "./board-registry"
import type { LoopTrackingRegistry } from "./loop-tracking-registry"
import type { FollowedSessionRegistry } from "./followed-session-registry"
import type { UpdateManager } from "./update-manager"
import type { PackageUpdateManager } from "./package-update-manager"
import type { PushManager } from "./push/push-manager"
import type { DiffStore } from "./diff-store"
import type { DiscoveredProject } from "./discovery.adapter"
import {
  getSidebarProjectOrder,
  isSendToStartingProfilingEnabled,
} from "./ws-router-utils"
import type { ClientState, SnapshotComputationCache } from "./ws-router-utils"
import type { ResolvedAppSettings } from "./ws-router-defaults"

const DEFAULT_CHAT_RECENT_LIMIT = 200

const MAX_BOARD_PAGE_SIZE = 500

export
function resolveTopicRepoPath(
  store: EventStore,
  projectId: string,
  chatId: string | undefined,
): string | null {
  const project = store.getProject(projectId)
  if (!project) return null
  if (chatId === undefined) return project.localPath
  const chat = store.getChat(chatId)
  if (!chat) return null
  return resolveSpawnPaths(chat, project.localPath).cwd
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
  resolvedDiffStore: Pick<DiffStore,
    "getSnapshot" | "refreshSnapshot" | "initializeGit" | "getGitHubPublishInfo" |
    "checkGitHubRepoAvailability" | "publishToGitHub" | "listBranches" | "previewMergeBranch" |
    "mergeBranch" | "syncBranch" | "checkoutBranch" | "createBranch" | "generateCommitMessage" |
    "commitFiles" | "discardFile" | "ignoreFile" | "readPatch">
  ptyInstances?: PtyInstanceRegistry
  workflowRegistry?: WorkflowRegistry
  backgroundTaskOutputRegistry?: BackgroundTaskOutputRegistry
  boardRegistry?: BoardRegistry
  loopTrackingRegistry?: LoopTrackingRegistry
  followedSessionRegistry?: FollowedSessionRegistry
  machineDisplayName: string
  updateManager: UpdateManager | null
  packageUpdateManager?: PackageUpdateManager
  getDiscoveredProjects: () => DiscoveredProject[]
  terminals: TerminalManager
  pushManager: PushManager
}


function buildSidebarSnapshotCacheEntry(
  deps: EnvelopeDeps,
  cache?: SnapshotComputationCache
): NonNullable<SnapshotComputationCache["sidebar"]> {
  if (cache?.sidebar) {
    return cache.sidebar
  }

  const { store, agent, pushManager, workflowRegistry, loopTrackingRegistry } = deps
  const startedAt = performance.now()
  const discoveredProvidersByPath = new Map(
    deps.getDiscoveredProjects().map((p) => [p.localPath, p.discoveredByProviders])
  )
  const data = deriveSidebarData(store.state, agent.getActiveStatuses(), {
    sidebarProjectOrder: getSidebarProjectOrder(store),
    drainingChatIds: agent.getDrainingChatIds(),
    claudeSessionStates: agent.getClaudeSessionStates?.(),
    discoveredProvidersByPath,
    workflowRegistry,
    backgroundTasksByChatId: agent.getBackgroundTasksByChatId?.() ?? new Map(),
    getLoopTracking: loopTrackingRegistry
      ? (chatId: string) => loopTrackingRegistry.snapshot(chatId)
      : undefined,
  })
  const observed = data.projectGroups.flatMap((group) =>
    group.chats.map((chat) => ({
      chatId: chat.chatId,
      projectLocalPath: group.localPath,
      projectTitle: group.localPath.split("/").filter(Boolean).pop() ?? group.localPath,
      chatTitle: chat.title,
      status: chat.status,
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
    ptyInstances,
    workflowRegistry,
    backgroundTaskOutputRegistry,
    boardRegistry,
    loopTrackingRegistry,
    followedSessionRegistry,
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

  function deriveChatMeta(chatId: string): ChatSnapshot | null {
    return deriveChatSnapshot(
      store.state,
      agent.getActiveStatuses(),
      agent.getDrainingChatIds(),
      chatId,
      (id) => store.getRecentChatHistory(id, 0),
      (id) => store.getTunnelEvents(id),
      agent.getWaitStartedAtByChatId(),
      Date.now(),
      agent.getClaudeSessionStates?.() ?? new Map(),
      resolvedAppSettings.getSnapshot().customModels ?? [],
      agent.getBackgroundTasksByChatId?.() ?? new Map(),
      (id) => loopTrackingRegistry?.snapshot(id) ?? null,
    )
  }

  function createEnvelope(
    id: string,
    topic: SubscriptionTopic,
    cache?: SnapshotComputationCache,
    connection?: ServerWebSocket<ClientState>,
  ): ServerEnvelope {
    if (topic.type === "sidebar") {
      const sidebar = getSidebarSnapshotCacheEntry(cache)
      return {
        v: PROTOCOL_VERSION,
        type: "snapshot",
        id,
        snapshot: {
          type: "sidebar",
          data: sidebar.data,
        },
      }
    }

    if (topic.type === "local-projects") {
      const discoveredProjects = getDiscoveredProjects()
      const data = deriveLocalProjectsSnapshot(store.state, discoveredProjects, machineDisplayName, os.homedir())

      return {
        v: PROTOCOL_VERSION,
        type: "snapshot",
        id,
        snapshot: {
          type: "local-projects",
          data,
        },
      }
    }

    if (topic.type === "keybindings") {
      return {
        v: PROTOCOL_VERSION,
        type: "snapshot",
        id,
        snapshot: {
          type: "keybindings",
          data: keybindings.getSnapshot(),
        },
      }
    }

    if (topic.type === "app-settings") {
      return {
        v: PROTOCOL_VERSION,
        type: "snapshot",
        id,
        snapshot: {
          type: "app-settings",
          data: resolvedAppSettings.getSnapshot(),
        },
      }
    }

    if (topic.type === "push-config") {
      return {
        v: PROTOCOL_VERSION,
        type: "snapshot",
        id,
        snapshot: {
          type: "push-config",
          data: pushManager.getConfigSnapshot(connection?.data.pushDeviceId ?? null),
        },
      }
    }

    if (topic.type === "update") {
      return {
        v: PROTOCOL_VERSION,
        type: "snapshot",
        id,
        snapshot: {
          type: "update",
          data: updateManager?.getSnapshot() ?? {
            currentVersion: "unknown",
            latestVersion: null,
            status: "idle",
            updateAvailable: false,
            lastCheckedAt: null,
            error: null,
            installAction: "restart",
            reloadRequestedAt: null,
          },
        },
      }
    }

    if (topic.type === "terminal") {
      return {
        v: PROTOCOL_VERSION,
        type: "snapshot",
        id,
        snapshot: {
          type: "terminal",
          data: terminals.getSnapshot(topic.terminalId),
        },
      }
    }

    if (topic.type === "project-git") {
      return {
        v: PROTOCOL_VERSION,
        type: "snapshot",
        id,
        snapshot: {
          type: "project-git",
          data: (() => {
            const repoPath = resolveTopicRepoPath(store, topic.projectId, topic.chatId)
            return repoPath === null ? null : resolvedDiffStore.getSnapshot(repoPath)
          })(),
        },
      }
    }

    if (topic.type === "project-commands") {
      const project = store.getProject(topic.projectId)
      return {
        v: PROTOCOL_VERSION,
        type: "snapshot",
        id,
        snapshot: {
          type: "project-commands",
          data: {
            projectId: topic.projectId,
            commands: project
              ? localCommandsForCwd({ localCatalog: agent.localCatalog }, project.localPath)
              : [],
          },
        },
      }
    }

    if (topic.type === "pty-instances") {
      return {
        v: PROTOCOL_VERSION,
        type: "snapshot",
        id,
        snapshot: {
          type: "pty-instances",
          data: { instances: ptyInstances?.snapshot() ?? [] },
        },
      }
    }

    if (topic.type === "workflows") {
      return {
        v: PROTOCOL_VERSION,
        type: "snapshot",
        id,
        snapshot: {
          type: "workflows",
          data: { chatId: topic.chatId, runs: workflowRegistry?.snapshot(topic.chatId) ?? [] },
        },
      }
    }

    if (topic.type === "background-task-output") {
      const output = backgroundTaskOutputRegistry?.getOutput(topic.chatId, topic.taskId)
      return {
        v: PROTOCOL_VERSION,
        type: "snapshot",
        id,
        snapshot: {
          type: "background-task-output",
          data: {
            chatId: topic.chatId,
            taskId: topic.taskId,
            content: output?.content ?? "",
            truncated: output?.truncated ?? false,
          },
        },
      }
    }

    if (topic.type === "boards") {
      const owner = { kind: topic.ownerKind, id: topic.ownerId }
      return {
        v: PROTOCOL_VERSION,
        type: "snapshot",
        id,
        snapshot: {
          type: "boards",
          data: {
            ownerKind: topic.ownerKind,
            ownerId: topic.ownerId,
            boards: boardRegistry?.listBoards(owner) ?? [],
          },
        },
      }
    }

    if (topic.type === "board") {
      return {
        v: PROTOCOL_VERSION,
        type: "snapshot",
        id,
        snapshot: {
          type: "board",
          data: {
            boardId: topic.boardId,
            view: boardRegistry?.boardView(topic.boardId, resolveBoardPageSize(topic.pageSize)) ?? null,
          },
        },
      }
    }

    if (topic.type === "followed-sessions") {
      return {
        v: PROTOCOL_VERSION,
        type: "snapshot",
        id,
        snapshot: {
          type: "followed-sessions",
          data: { chatIds: followedSessionRegistry?.followedChatIds() ?? [] },
        },
      }
    }

    if (topic.type === "cron-jobs") {
      return {
        v: PROTOCOL_VERSION,
        type: "snapshot",
        id,
        snapshot: {
          type: "cron-jobs",
          data: { rows: buildCronJobsGlobalRows(store) },
        },
      }
    }

    if (topic.type === "package-updates") {
      return {
        v: PROTOCOL_VERSION,
        type: "snapshot",
        id,
        snapshot: {
          type: "package-updates",
          data: packageUpdateManager?.getSnapshot() ?? {
            status: "idle",
            packages: [],
            lastCheckedAt: null,
            error: null,
            applying: [],
            autoApplyHistory: [],
          },
        },
      }
    }

    const seq = typeof store.chatOps?.currentSeq === "function"
      ? store.chatOps.currentSeq(topic.chatId)
      : undefined
    const data = deriveChatSnapshot(
      store.state,
      agent.getActiveStatuses(),
      agent.getDrainingChatIds(),
      topic.chatId,
      (chatId) => store.getRecentChatHistory(chatId, topic.recentLimit ?? DEFAULT_CHAT_RECENT_LIMIT),
      (chatId) => store.getTunnelEvents(chatId),
      agent.getWaitStartedAtByChatId(),
      Date.now(),
      agent.getClaudeSessionStates?.() ?? new Map(),
      resolvedAppSettings.getSnapshot().customModels ?? [],
      agent.getBackgroundTasksByChatId?.() ?? new Map(),
      (id) => loopTrackingRegistry?.snapshot(id) ?? null,
    )
    return {
      v: PROTOCOL_VERSION,
      type: "snapshot",
      id,
      snapshot: {
        type: "chat",
        data: data && seq !== undefined ? { ...data, seq } : data,
      },
    }
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
