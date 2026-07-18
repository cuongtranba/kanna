/**
 * ws-router-envelope.ts
 *
 * Snapshot-envelope computation for the WebSocket router.
 * Extracted from ws-router.ts to reduce its size.
 *
 * `createEnvelopeBuilder(deps)` returns `{ createEnvelope, getSidebarSnapshotCacheEntry }`
 * whose closures capture the stable dep objects — no shared mutable state lives here.
 */
import os from "node:os"
import { log } from "../shared/log"
import { PROTOCOL_VERSION } from "../shared/types"
import type { ServerEnvelope, SubscriptionTopic } from "../shared/protocol"
import type { ServerWebSocket } from "bun"
import { deriveChatSnapshot, deriveLocalProjectsSnapshot, deriveSidebarData } from "./read-models"
import { toOrchRunSummary } from "./orchestration-input"
import type { EventStore } from "./event-store"
import type { AgentCoordinator } from "./agent"
import type { TerminalManager } from "./terminal-manager"
import type { KeybindingsManager } from "./keybindings"
import type { PtyInstanceRegistry } from "./claude-pty/pty-instance-registry"
import type { WorkflowRegistry } from "./workflow-registry"
import type { UpdateManager } from "./update-manager"
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

// ── Deps type ─────────────────────────────────────────────────────────────────

export interface EnvelopeDeps {
  store: EventStore
  agent: AgentCoordinator
  resolvedAppSettings: ResolvedAppSettings
  keybindings: KeybindingsManager
  resolvedDiffStore: Pick<DiffStore,
    "getProjectSnapshot" | "refreshSnapshot" | "initializeGit" | "getGitHubPublishInfo" |
    "checkGitHubRepoAvailability" | "publishToGitHub" | "listBranches" | "previewMergeBranch" |
    "mergeBranch" | "syncBranch" | "checkoutBranch" | "createBranch" | "generateCommitMessage" |
    "commitFiles" | "discardFile" | "ignoreFile" | "readPatch">
  ptyInstances?: PtyInstanceRegistry
  workflowRegistry?: WorkflowRegistry
  machineDisplayName: string
  updateManager: UpdateManager | null
  getDiscoveredProjects: () => DiscoveredProject[]
  terminals: TerminalManager
  pushManager: PushManager
}

// ── Internal: sidebar cache entry ─────────────────────────────────────────────

function buildSidebarSnapshotCacheEntry(
  deps: EnvelopeDeps,
  cache?: SnapshotComputationCache
): NonNullable<SnapshotComputationCache["sidebar"]> {
  if (cache?.sidebar) {
    return cache.sidebar
  }

  const { store, agent, pushManager } = deps
  const startedAt = performance.now()
  const data = deriveSidebarData(store.state, agent.getActiveStatuses(), {
    sidebarProjectOrder: getSidebarProjectOrder(store),
    drainingChatIds: agent.getDrainingChatIds(),
    claudeSessionStates: agent.getClaudeSessionStates?.(),
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

// ── Exported factory ──────────────────────────────────────────────────────────

export interface EnvelopeBuilder {
  /**
   * Returns a cached sidebar entry (computes it once per cache object).
   * Exposed so callers can read the pre-computed signature for dedup.
   */
  getSidebarSnapshotCacheEntry(cache?: SnapshotComputationCache): NonNullable<SnapshotComputationCache["sidebar"]>
  /**
   * Build the full ServerEnvelope for a given subscription topic.
   */
  createEnvelope(
    id: string,
    topic: SubscriptionTopic,
    cache?: SnapshotComputationCache,
    connection?: ServerWebSocket<ClientState>,
  ): ServerEnvelope
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
    machineDisplayName,
    updateManager,
    getDiscoveredProjects,
    terminals,
    pushManager,
  } = deps

  function getSidebarSnapshotCacheEntry(cache?: SnapshotComputationCache) {
    return buildSidebarSnapshotCacheEntry(deps, cache)
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
          data: store.getProject(topic.projectId)
            ? resolvedDiffStore.getProjectSnapshot(topic.projectId)
            : null,
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

    if (topic.type === "orch-runs") {
      return {
        v: PROTOCOL_VERSION,
        type: "snapshot",
        id,
        snapshot: {
          type: "orch-runs",
          data: { runs: store.getOrchRuns().map(toOrchRunSummary) },
        },
      }
    }

    // Capture seq BEFORE deriving: ops recorded mid-derive then overlap the
    // snapshot, and the client reducer's upsert-by-_id makes that idempotent.
    // Optional-chained like subscribeOrchRuns: partial store fakes in tests
    // may not implement chatOps; the real EventStore always does.
    const seq = typeof store.chatOps?.currentSeq === "function"
      ? store.chatOps.currentSeq(topic.chatId)
      : undefined
    const data = deriveChatSnapshot(
      store.state,
      agent.getActiveStatuses(),
      agent.getDrainingChatIds(),
      agent.getSlashCommandsLoadingChatIds(),
      topic.chatId,
      (chatId) => store.getRecentChatHistory(chatId, topic.recentLimit ?? DEFAULT_CHAT_RECENT_LIMIT),
      (chatId) => store.getTunnelEvents(chatId),
      agent.getWaitStartedAtByChatId(),
      Date.now(),
      agent.getClaudeSessionStates?.() ?? new Map(),
      resolvedAppSettings.getSnapshot().customModels ?? [],
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

  return { getSidebarSnapshotCacheEntry, createEnvelope }
}
