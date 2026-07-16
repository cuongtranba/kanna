import { randomUUID } from "node:crypto"
import type { AnyValue } from "../shared/errors"
import { log } from "../shared/log"
import os from "node:os"
import type { ServerWebSocket } from "bun"
import { PROTOCOL_VERSION } from "../shared/types"
import type { ClientEnvelope, PtyInstancesEvent, ServerEnvelope, SubscriptionTopic } from "../shared/protocol"
import type { PtyInstanceDelta } from "../shared/pty-instance"
import type { PtyInstanceRegistry } from "./claude-pty/pty-instance-registry"
import type { WorkflowRegistry } from "./workflow-registry"
import type { SubagentTranscriptRegistry } from "./subagent-transcript-registry"
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
import { deriveChatSnapshot, deriveLocalProjectsSnapshot, deriveSidebarData } from "./read-models"
import { toOrchRunSummary } from "./orchestration-input"
import { AUTH_DEFAULTS, CLAUDE_AUTH_DEFAULTS, CLAUDE_DRIVER_DEFAULTS, CLAUDE_PTY_LIFECYCLE_DEFAULTS, CLOUDFLARE_TUNNEL_DEFAULTS, DEFAULT_OPENROUTER_SDK_MODEL, UPLOAD_DEFAULTS } from "../shared/types"
import type {
  AppSettingsPatch,
  AppSettingsSnapshot,
  LlmProviderSnapshot,
  LlmProviderValidationResult,
  OpenRouterModel,
  Subagent,
} from "../shared/types"
import { importClaudeSessions } from "./claude-session-importer.adapter"
import { listWorktrees } from "./worktree-store.adapter"
import type { TunnelGateway } from "./cloudflare-tunnel/gateway"
import type { PushManager } from "./push/push-manager"
import type { SessionShareService } from "./session-share"
import { handleSettingsCommand } from "./ws-router-settings"
import { handleDiffCommand } from "./ws-router-diff"
import { handleOrchCommand } from "./ws-router-orch"
import { handleAgentCtrlCommand } from "./ws-router-agent-ctrl"
import { handlePushCommand } from "./ws-router-push"
import { handleMiscCommand } from "./ws-router-misc"
import { handleProjectCommand } from "./ws-router-project"
import { handleChatCommand } from "./ws-router-chat"

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

const DEFAULT_CHAT_RECENT_LIMIT = 200

function isSendToStartingProfilingEnabled() {
  return process.env.KANNA_PROFILE_SEND_TO_STARTING === "1"
}

function logSendToStartingProfile(
  traceId: string | null | undefined,
  startedAt: number | null | undefined,
  stage: string,
  details?: Record<string, unknown>
) {
  if (!traceId || startedAt === undefined || startedAt === null || !isSendToStartingProfilingEnabled()) {
    return
  }

  log.info("[kanna/send->starting][server]", JSON.stringify({
    traceId,
    stage,
    elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
    ...details,
  }))
}

function countSubscriptionsByTopic(ws: ServerWebSocket<ClientState>) {
  let sidebar = 0
  let chat = 0
  let projectGit = 0
  let localProjects = 0
  let update = 0
  let keybindings = 0
  let appSettings = 0
  let terminal = 0

  for (const topic of ws.data.subscriptions.values()) {
    switch (topic.type) {
      case "sidebar":
        sidebar += 1
        break
      case "chat":
        chat += 1
        break
      case "project-git":
        projectGit += 1
        break
      case "local-projects":
        localProjects += 1
        break
      case "update":
        update += 1
        break
      case "keybindings":
        keybindings += 1
        break
      case "app-settings":
        appSettings += 1
        break
      case "terminal":
        terminal += 1
        break
    }
  }

  return {
    total: ws.data.subscriptions.size,
    sidebar,
    chat,
    projectGit,
    localProjects,
    update,
    keybindings,
    appSettings,
    terminal,
  }
}

export interface ClientState {
  subscriptions: Map<string, SubscriptionTopic>
  snapshotSignatures: Map<string, string>
  protectedDraftChatIds?: Set<string>
  pushDeviceId?: string | null
  originHost?: string
}

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

interface SnapshotBroadcastFilter {
  includeSidebar?: boolean
  includeLocalProjects?: boolean
  includeUpdate?: boolean
  includeKeybindings?: boolean
  includeAppSettings?: boolean
  includePushConfig?: boolean
  chatIds?: Set<string>
  projectIds?: Set<string>
  terminalIds?: Set<string>
}

interface SnapshotComputationCache {
  sidebar?: {
    data: ReturnType<typeof deriveSidebarData>
    signature: string
  }
}

function getSidebarProjectOrder(store: EventStore) {
  return typeof store.getSidebarProjectOrder === "function"
    ? store.getSidebarProjectOrder()
    : []
}

// Stale-state command failures happen during normal client/server races
// (e.g. the user steers a queued message that drained between snapshots).
// They flood pm2 logs at console.error level; downgrade to console.log.
const BENIGN_STALE_STATE_MESSAGES = [
  /^Chat not found$/,
  /^Queued message not found$/,
  /^File is no longer changed: /,
  /^Project not found$/,
] as const

export function isBenignStaleStateMessage(message: string): boolean {
  return BENIGN_STALE_STATE_MESSAGES.some((pattern) => pattern.test(message))
}

function send(ws: ServerWebSocket<ClientState>, message: ServerEnvelope) {
  const payload = JSON.stringify(message)
  ws.send(payload)
  return payload.length
}


function ensureSnapshotSignatures(ws: ServerWebSocket<ClientState>) {
  if (!ws.data.snapshotSignatures) {
    ws.data.snapshotSignatures = new Map()
  }

  return ws.data.snapshotSignatures
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
  const sockets = new Set<ServerWebSocket<ClientState>>()
  let pendingBroadcastTimer: ReturnType<typeof setTimeout> | null = null
  let pendingBroadcastAll = false
  const pendingBroadcastChatIds = new Set<string>()
  const resolvedDiffStore = diffStore ?? {
    getProjectSnapshot: () => ({ status: "unknown", branchName: undefined, defaultBranchName: undefined, hasOriginRemote: undefined, originRepoSlug: undefined, hasUpstream: undefined, aheadCount: undefined, behindCount: undefined, lastFetchedAt: undefined, files: [] as const, branchHistory: { entries: [] as const } }),
    refreshSnapshot: async () => false,
    initializeGit: async () => ({ ok: true, branchName: undefined, snapshotChanged: false }),
    getGitHubPublishInfo: async () => ({ ghInstalled: false, authenticated: false, activeAccountLogin: undefined, owners: [], suggestedRepoName: "my-repo" }),
    checkGitHubRepoAvailability: async () => ({ available: false, message: "Unavailable" }),
    publishToGitHub: async () => ({ ok: false, title: "Publish failed", message: "Unavailable", snapshotChanged: false }),
    listBranches: async () => ({ recent: [], local: [], remote: [], pullRequests: [], pullRequestsStatus: "unavailable" as const }),
    previewMergeBranch: async () => ({ currentBranchName: undefined, targetBranchName: "", targetDisplayName: "", status: "error" as const, commitCount: 0, hasConflicts: false, message: "Merge preview unavailable." }),
    mergeBranch: async () => ({ ok: false as const, title: "Merge failed", message: "Merge unavailable.", snapshotChanged: false }),
    syncBranch: async () => ({ ok: true, action: "fetch" as const, branchName: undefined, snapshotChanged: false }),
    checkoutBranch: async () => ({ ok: true, branchName: undefined, snapshotChanged: false }),
    createBranch: async () => ({ ok: true, branchName: "main", snapshotChanged: false }),
    generateCommitMessage: async () => ({ subject: "Update selected files", body: "", usedFallback: true, failureMessage: null }),
    commitFiles: async () => ({ ok: true, mode: "commit_only" as const, branchName: undefined, pushed: false, snapshotChanged: false }),
    discardFile: async () => ({ snapshotChanged: false }),
    ignoreFile: async () => ({ snapshotChanged: false }),
    readPatch: async () => ({ patch: "" }),
  }
  const resolvedLlmProvider = llmProvider ?? {
    read: async () => ({
      provider: "openai" as const,
      apiKey: "",
      model: "gpt-5.4-mini",
      baseUrl: "",
      resolvedBaseUrl: "https://api.openai.com/v1",
      enabled: false,
      warning: null,
      filePathDisplay: "~/.kanna/llm-provider.json",
    }),
    write: async ({ provider, apiKey, model, baseUrl }: {
      provider: "openai" | "openrouter" | "custom"
      apiKey: string
      model: string
      baseUrl: string
    }) => {
      let resolvedBaseUrl: string
      if (provider === "openrouter") {
        resolvedBaseUrl = "https://openrouter.ai/api/v1"
      } else if (provider === "custom") {
        resolvedBaseUrl = baseUrl
      } else {
        resolvedBaseUrl = "https://api.openai.com/v1"
      }
      return {
        provider,
        apiKey,
        model,
        baseUrl,
        resolvedBaseUrl,
        enabled: false,
        warning: null,
        filePathDisplay: "~/.kanna/llm-provider.json",
      }
    },
    validate: async () => ({
      ok: false,
      error: {
        type: "config_error",
        message: "LLM provider validation unavailable.",
      },
    }),
  }
  let fallbackAppSettingsSnapshot: AppSettingsSnapshot = {
    analyticsEnabled: true,
    browserSettingsMigrated: false,
    theme: "system",
    chatSoundPreference: "always",
    chatSoundId: "funk",
    terminal: {
      scrollbackLines: 1_000,
      minColumnWidth: 450,
    },
    editor: {
      preset: "cursor",
      commandTemplate: "cursor {path}",
    },
    defaultProvider: "last_used",
    providerDefaults: {
      claude: {
        model: "claude-opus-4-7",
        modelOptions: {
          reasoningEffort: "high",
          contextWindow: "200k",
        },
        planMode: false,
      },
      codex: {
        model: "gpt-5.5",
        modelOptions: {
          reasoningEffort: "high",
          fastMode: false,
        },
        planMode: false,
      },
      openrouter: {
        model: DEFAULT_OPENROUTER_SDK_MODEL,
        modelOptions: {},
        planMode: false,
      },
    },
    warning: null,
    filePathDisplay: "~/.kanna/data/settings.json",
    cloudflareTunnel: CLOUDFLARE_TUNNEL_DEFAULTS,
    auth: AUTH_DEFAULTS,
    claudeAuth: CLAUDE_AUTH_DEFAULTS,
    uploads: UPLOAD_DEFAULTS,
    subagents: [],
    customMcpServers: [],
    customModels: [],
    textSnippets: [],
    claudeDriver: { ...CLAUDE_DRIVER_DEFAULTS, lifecycle: { ...CLAUDE_PTY_LIFECYCLE_DEFAULTS } },
    globalPromptAppend: "",
    shareDefaultTtlHours: 24,
    subagentRuntime: { runTimeoutMs: 600_000, defaultLoopSubagentId: null },
  }
  const mergeAppSettingsPatch = (snapshot: AppSettingsSnapshot, patch: AppSettingsPatch): AppSettingsSnapshot => {
    let subagents = snapshot.subagents
    if (patch.subagents?.create) {
      const now = Date.now()
      subagents = [...subagents, {
        id: randomUUID(),
        ...patch.subagents.create,
        name: patch.subagents.create.name.trim(),
        triggerMode: patch.subagents.create.triggerMode ?? "auto",
        createdAt: now,
        updatedAt: now,
      }]
    } else if (patch.subagents?.update) {
      subagents = subagents.map((subagent): Subagent => subagent.id === patch.subagents?.update?.id
        ? {
            ...subagent,
            ...patch.subagents.update.patch,
            name: patch.subagents.update.patch.name?.trim() ?? subagent.name,
            description: patch.subagents.update.patch.description === null
              ? undefined
              : patch.subagents.update.patch.description ?? subagent.description,
            modelOptions: <Subagent["modelOptions"]>{ ...subagent.modelOptions, ...(patch.subagents.update.patch.modelOptions ?? {}) },
            workingDir: patch.subagents.update.patch.workingDir === null
              ? undefined
              : patch.subagents.update.patch.workingDir ?? subagent.workingDir,
            allowedPaths: patch.subagents.update.patch.allowedPaths === null
              ? undefined
              : patch.subagents.update.patch.allowedPaths ?? subagent.allowedPaths,
            maxTurns: patch.subagents.update.patch.maxTurns === null
              ? undefined
              : patch.subagents.update.patch.maxTurns ?? subagent.maxTurns,
            updatedAt: Date.now(),
          }
        : subagent)
    } else if (patch.subagents?.delete) {
      subagents = subagents.filter((subagent) => subagent.id !== patch.subagents?.delete?.id)
    }

    return {
      ...snapshot,
      ...patch,
      terminal: {
        ...snapshot.terminal,
        ...patch.terminal,
      },
      editor: {
        ...snapshot.editor,
        ...patch.editor,
      },
      providerDefaults: {
        claude: {
          ...snapshot.providerDefaults.claude,
          ...patch.providerDefaults?.claude,
          modelOptions: {
            ...snapshot.providerDefaults.claude.modelOptions,
            ...patch.providerDefaults?.claude?.modelOptions,
          },
        },
        codex: {
          ...snapshot.providerDefaults.codex,
          ...patch.providerDefaults?.codex,
          modelOptions: {
            ...snapshot.providerDefaults.codex.modelOptions,
            ...patch.providerDefaults?.codex?.modelOptions,
          },
        },
        openrouter: {
          ...snapshot.providerDefaults.openrouter,
          ...patch.providerDefaults?.openrouter,
          modelOptions: {},
        },
      },
      cloudflareTunnel: {
        ...snapshot.cloudflareTunnel,
        ...patch.cloudflareTunnel,
      },
      auth: {
        ...snapshot.auth,
        ...patch.auth,
      },
      claudeAuth: {
        tokens: patch.claudeAuth?.tokens ?? snapshot.claudeAuth.tokens,
        concurrencyDefault: patch.claudeAuth?.concurrencyDefault ?? snapshot.claudeAuth.concurrencyDefault,
      },
      uploads: {
        ...snapshot.uploads,
        ...patch.uploads,
      },
      subagents,
      customMcpServers: snapshot.customMcpServers,
      customModels: snapshot.customModels,
      textSnippets: snapshot.textSnippets,
      claudeDriver: {
        preference: patch.claudeDriver?.preference ?? snapshot.claudeDriver.preference,
        lifecycle: {
          ...snapshot.claudeDriver.lifecycle,
          ...patch.claudeDriver?.lifecycle,
        },
      },
      subagentRuntime: {
        runTimeoutMs: patch.subagentRuntime?.runTimeoutMs ?? snapshot.subagentRuntime.runTimeoutMs,
        defaultLoopSubagentId: patch.subagentRuntime?.defaultLoopSubagentId !== undefined
          ? patch.subagentRuntime.defaultLoopSubagentId
          : snapshot.subagentRuntime.defaultLoopSubagentId,
      },
    }
  }
  const resolvedAppSettings = {
    getSnapshot: () => appSettings?.getSnapshot() ?? fallbackAppSettingsSnapshot,
    write: async (value: { analyticsEnabled: boolean }) => {
      if (appSettings) return await appSettings.write(value)
      fallbackAppSettingsSnapshot = { ...fallbackAppSettingsSnapshot, analyticsEnabled: value.analyticsEnabled }
      return fallbackAppSettingsSnapshot
    },
    writePatch: async (patch: AppSettingsPatch) => {
      if (appSettings?.writePatch) return await appSettings.writePatch(patch)
      if (appSettings && patch.analyticsEnabled !== undefined && Object.keys(patch).length === 1) {
        return await appSettings.write({ analyticsEnabled: patch.analyticsEnabled })
      }
      fallbackAppSettingsSnapshot = mergeAppSettingsPatch(appSettings?.getSnapshot() ?? fallbackAppSettingsSnapshot, patch)
      return fallbackAppSettingsSnapshot
    },
    setCloudflareTunnel: async (patch: Partial<AppSettingsSnapshot["cloudflareTunnel"]>) => {
      if (appSettings?.setCloudflareTunnel) return await appSettings.setCloudflareTunnel(patch)
      fallbackAppSettingsSnapshot = mergeAppSettingsPatch(appSettings?.getSnapshot() ?? fallbackAppSettingsSnapshot, { cloudflareTunnel: patch })
      return fallbackAppSettingsSnapshot
    },
    setClaudeAuth: async (patch: Partial<AppSettingsSnapshot["claudeAuth"]>) => {
      if (appSettings?.setClaudeAuth) return await appSettings.setClaudeAuth(patch)
      fallbackAppSettingsSnapshot = mergeAppSettingsPatch(
        appSettings?.getSnapshot() ?? fallbackAppSettingsSnapshot,
        { claudeAuth: patch },
      )
      return fallbackAppSettingsSnapshot
    },
    createSubagent: async (input: Parameters<AppSettingsManager["createSubagent"]>[0]) => {
      if (appSettings?.createSubagent) return await appSettings.createSubagent(input)
      const snapshot = await resolvedAppSettings.writePatch({ subagents: { create: input } })
      return snapshot.subagents[snapshot.subagents.length - 1] ?? { code: "NOT_FOUND" as const, message: "Created subagent not found" }
    },
    updateSubagent: async (id: string, patch: Parameters<AppSettingsManager["updateSubagent"]>[1]) => {
      if (appSettings?.updateSubagent) return await appSettings.updateSubagent(id, patch)
      const snapshot = await resolvedAppSettings.writePatch({ subagents: { update: { id, patch } } })
      return snapshot.subagents.find((subagent) => subagent.id === id) ?? { code: "NOT_FOUND" as const, message: `Subagent ${id} not found` }
    },
    deleteSubagent: async (id: string) => {
      if (appSettings?.deleteSubagent) return await appSettings.deleteSubagent(id)
      await resolvedAppSettings.writePatch({ subagents: { delete: { id } } })
    },
    onChange: (listener: (snapshot: AppSettingsSnapshot) => void) => appSettings?.onChange?.(listener) ?? (() => {}),
  }
  const resolvedAnalytics = analytics ?? NoopAnalyticsReporter

  function getProtectedChatIds() {
    const activeStatuses = agent.getActiveStatuses()
    const drainingChatIds = typeof agent.getDrainingChatIds === "function"
      ? agent.getDrainingChatIds()
      : new Set<string>()
    return new Set([
      ...activeStatuses.keys(),
      ...drainingChatIds.values(),
    ])
  }

  function getProtectedDraftChatIds(extraSockets?: Iterable<ServerWebSocket<ClientState>>) {
    const protectedChatIds = new Set<string>()

    for (const socket of sockets) {
      for (const chatId of socket.data.protectedDraftChatIds ?? []) {
        protectedChatIds.add(chatId)
      }
    }

    for (const socket of extraSockets ?? []) {
      for (const chatId of socket.data.protectedDraftChatIds ?? []) {
        protectedChatIds.add(chatId)
      }
    }

    return protectedChatIds
  }

  async function maybePruneStaleEmptyChats(extraSockets?: Iterable<ServerWebSocket<ClientState>>) {
    const startedAt = performance.now()
    const activeChatIds = getProtectedChatIds()
    const protectedDraftChatIds = getProtectedDraftChatIds(extraSockets)
    const prunedChatIds = await store.pruneStaleEmptyChats?.({
      activeChatIds,
      protectedChatIds: protectedDraftChatIds,
    })
    if (isSendToStartingProfilingEnabled()) {
      log.info("[kanna/send->starting][server]", JSON.stringify({
        stage: "ws.prune_stale_empty_chats",
        elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
        activeChatCount: activeChatIds.size,
        protectedDraftChatCount: protectedDraftChatIds.size,
        prunedCount: prunedChatIds?.length ?? 0,
        totalChatCount: store.state.chatsById.size,
        totalProjectCount: store.state.projectsById.size,
      }))
    }
  }

  function shouldIncludeTopic(topic: SubscriptionTopic, filter?: SnapshotBroadcastFilter) {
    if (!filter) {
      return true
    }

    if (topic.type === "sidebar") {
      return Boolean(filter.includeSidebar)
    }
    if (topic.type === "local-projects") {
      return Boolean(filter.includeLocalProjects)
    }
    if (topic.type === "update") {
      return Boolean(filter.includeUpdate)
    }
    if (topic.type === "keybindings") {
      return Boolean(filter.includeKeybindings)
    }
    if (topic.type === "app-settings") {
      return Boolean(filter.includeAppSettings)
    }
    if (topic.type === "push-config") {
      return Boolean(filter.includePushConfig)
    }
    if (topic.type === "chat") {
      return filter.chatIds?.has(topic.chatId) ?? false
    }
    if (topic.type === "project-git") {
      return filter.projectIds?.has(topic.projectId) ?? false
    }
    if (topic.type === "terminal") {
      return filter.terminalIds?.has(topic.terminalId) ?? false
    }

    return true
  }

  function getSidebarSnapshotCacheEntry(cache?: SnapshotComputationCache) {
    if (cache?.sidebar) {
      return cache.sidebar
    }

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

    return {
      v: PROTOCOL_VERSION,
      type: "snapshot",
      id,
      snapshot: {
        type: "chat",
        data: deriveChatSnapshot(
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
          appSettings?.getSnapshot().customModels ?? [],
        ),
      },
    }
  }

  // timings.derivedAtMs = Date.now() on every call, making every snapshot unique
  // and defeating signature-based dedup. Strip timings from the signature so that
  // idle/finished chats are only sent once instead of on every broadcastSnapshots call.
  function getStableChatSnapshotSignature(snapshot: Extract<ServerEnvelope, { type: "snapshot" }>["snapshot"]): string {
    if (snapshot.type === "chat" && snapshot.data?.runtime) {
      const { timings: _t, ...stableRuntime } = snapshot.data.runtime
      return JSON.stringify({ type: snapshot.type, data: { ...snapshot.data, runtime: stableRuntime } })
    }
    return JSON.stringify(snapshot)
  }

  async function pushSnapshots(
    ws: ServerWebSocket<ClientState>,
    options?: { skipPrune?: boolean; filter?: SnapshotBroadcastFilter; cache?: SnapshotComputationCache }
  ) {
    const pushStartedAt = performance.now()
    if (!options?.skipPrune) {
      await maybePruneStaleEmptyChats([ws])
    }
    const snapshotSignatures = ensureSnapshotSignatures(ws)
    let sentCount = 0
    let skippedCount = 0
    for (const [id, topic] of ws.data.subscriptions.entries()) {
      if (!shouldIncludeTopic(topic, options?.filter)) {
        continue
      }
      const envelopeStartedAt = performance.now()
      const envelope = createEnvelope(id, topic, options?.cache, ws)
      const createdAt = performance.now()
      if (envelope.type !== "snapshot") continue
      const signature = topic.type === "sidebar"
        ? getSidebarSnapshotCacheEntry(options?.cache).signature
        : getStableChatSnapshotSignature(envelope.snapshot)
      const signatureReadyAt = topic.type === "sidebar" ? createdAt : performance.now()
      if (snapshotSignatures.get(id) === signature) {
        skippedCount += 1
        continue
      }
      snapshotSignatures.set(id, signature)
      if (topic.type === "chat" && envelope.snapshot.type === "chat" && envelope.snapshot.data?.runtime.status === "starting") {
        const profile = agent.getActiveTurnProfile(topic.chatId)
        logSendToStartingProfile(profile?.traceId, profile?.startedAt, "ws.snapshot_sent", {
          chatId: topic.chatId,
          status: envelope.snapshot.data.runtime.status,
          messageCount: envelope.snapshot.data.messages.length,
          buildMs: Number((createdAt - envelopeStartedAt).toFixed(1)),
          signatureMs: Number((signatureReadyAt - createdAt).toFixed(1)),
          signatureBytes: signature.length,
        })
      }
      const payloadBytes = send(ws, envelope)
      sentCount += 1
      if (topic.type === "chat" && envelope.snapshot.type === "chat" && envelope.snapshot.data?.runtime.status === "starting") {
        const profile = agent.getActiveTurnProfile(topic.chatId)
        logSendToStartingProfile(profile?.traceId, profile?.startedAt, "ws.snapshot_send_completed", {
          chatId: topic.chatId,
          payloadBytes,
        })
      }
    }
    if (isSendToStartingProfilingEnabled()) {
      log.info("[kanna/send->starting][server]", JSON.stringify({
        stage: "ws.push_snapshots_completed",
        elapsedMs: Number((performance.now() - pushStartedAt).toFixed(1)),
        skipPrune: Boolean(options?.skipPrune),
        sentCount,
        skippedCount,
        ...countSubscriptionsByTopic(ws),
      }))
    }
  }

  async function broadcastSnapshots() {
    const startedAt = performance.now()
    let socketCount = 0
    const cache: SnapshotComputationCache = {}
    for (const ws of sockets) {
      socketCount += 1
      await pushSnapshots(ws, { skipPrune: true, cache })
    }
    if (isSendToStartingProfilingEnabled()) {
      log.info("[kanna/send->starting][server]", JSON.stringify({
        stage: "ws.broadcast_snapshots_completed",
        elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
        pruneMs: 0,
        socketCount,
        totalChatCount: store.state.chatsById.size,
        totalProjectCount: store.state.projectsById.size,
      }))
    }
  }

  async function broadcastFilteredSnapshots(filter: SnapshotBroadcastFilter) {
    const startedAt = performance.now()
    let socketCount = 0
    const cache: SnapshotComputationCache = {}
    for (const ws of sockets) {
      socketCount += 1
      await pushSnapshots(ws, { skipPrune: true, filter, cache })
    }
    if (isSendToStartingProfilingEnabled()) {
      log.info("[kanna/send->starting][server]", JSON.stringify({
        stage: "ws.broadcast_filtered_snapshots_completed",
        elapsedMs: Number((performance.now() - startedAt).toFixed(1)),
        socketCount,
        includeSidebar: Boolean(filter.includeSidebar),
        chatCount: filter.chatIds?.size ?? 0,
        projectCount: filter.projectIds?.size ?? 0,
      }))
    }
  }

  function scheduleBroadcast() {
    pendingBroadcastAll = true
    pendingBroadcastChatIds.clear()
    if (pendingBroadcastTimer) {
      return
    }
    pendingBroadcastTimer = setTimeout(() => {
      pendingBroadcastTimer = null
      const shouldBroadcastAll = pendingBroadcastAll
      const chatIds = new Set(pendingBroadcastChatIds)
      pendingBroadcastAll = false
      pendingBroadcastChatIds.clear()
      if (shouldBroadcastAll) {
        void broadcastSnapshots()
        return
      }
      if (chatIds.size > 0) {
        void broadcastFilteredSnapshots({
          includeSidebar: true,
          chatIds,
        })
      }
    }, 16)
  }

  function scheduleChatStateBroadcast(chatId: string) {
    if (!pendingBroadcastAll) {
      pendingBroadcastChatIds.add(chatId)
    }
    if (pendingBroadcastTimer) {
      return
    }
    pendingBroadcastTimer = setTimeout(() => {
      pendingBroadcastTimer = null
      const shouldBroadcastAll = pendingBroadcastAll
      const chatIds = new Set(pendingBroadcastChatIds)
      pendingBroadcastAll = false
      pendingBroadcastChatIds.clear()
      if (shouldBroadcastAll) {
        void broadcastSnapshots()
        return
      }
      if (chatIds.size > 0) {
        void broadcastFilteredSnapshots({
          includeSidebar: true,
          chatIds,
        })
      }
    }, 16)
  }

  async function broadcastChatAndSidebar(chatId: string) {
    await broadcastFilteredSnapshots({
      includeSidebar: true,
      chatIds: new Set([chatId]),
    })
  }

  async function broadcastChatStateImmediately(chatId: string) {
    await broadcastChatAndSidebar(chatId)
  }

  function broadcastError(message: string) {
    for (const ws of sockets) {
      send(ws, {
        v: PROTOCOL_VERSION,
        type: "error",
        message,
      })
    }
  }

  function pushTerminalSnapshot(terminalId: string) {
    for (const ws of sockets) {
      const snapshotSignatures = ensureSnapshotSignatures(ws)
      for (const [id, topic] of ws.data.subscriptions.entries()) {
        if (topic.type !== "terminal" || topic.terminalId !== terminalId) continue
        const envelope = createEnvelope(id, topic, undefined, ws)
        if (envelope.type !== "snapshot") continue
        const signature = JSON.stringify(envelope.snapshot)
        if (snapshotSignatures.get(id) === signature) continue
        snapshotSignatures.set(id, signature)
        send(ws, envelope)
      }
    }
  }

  function pushTerminalEvent(terminalId: string, event: Extract<ServerEnvelope, { type: "event" }>["event"]) {
    for (const ws of sockets) {
      for (const [id, topic] of ws.data.subscriptions.entries()) {
        if (topic.type !== "terminal" || topic.terminalId !== terminalId) continue
        send(ws, {
          v: PROTOCOL_VERSION,
          type: "event",
          id,
          event,
        })
      }
    }
  }

  const disposeTerminalEvents = terminals.onEvent((event) => {
    pushTerminalEvent(event.terminalId, event)
  })

  const disposeKeybindingEvents = keybindings.onChange(() => {
    for (const ws of sockets) {
      const snapshotSignatures = ensureSnapshotSignatures(ws)
      for (const [id, topic] of ws.data.subscriptions.entries()) {
        if (topic.type !== "keybindings") continue
        const envelope = createEnvelope(id, topic, undefined, ws)
        if (envelope.type !== "snapshot") continue
        const signature = JSON.stringify(envelope.snapshot)
        if (snapshotSignatures.get(id) === signature) continue
        snapshotSignatures.set(id, signature)
        send(ws, envelope)
      }
    }
  })

  const disposeAppSettingsEvents = resolvedAppSettings.onChange(() => {
    for (const ws of sockets) {
      const snapshotSignatures = ensureSnapshotSignatures(ws)
      for (const [id, topic] of ws.data.subscriptions.entries()) {
        if (topic.type !== "app-settings") continue
        const envelope = createEnvelope(id, topic, undefined, ws)
        if (envelope.type !== "snapshot") continue
        const signature = JSON.stringify(envelope.snapshot)
        if (snapshotSignatures.get(id) === signature) continue
        snapshotSignatures.set(id, signature)
        send(ws, envelope)
      }
    }
  })

  const disposeUpdateEvents = updateManager?.onChange(() => {
    for (const ws of sockets) {
      const snapshotSignatures = ensureSnapshotSignatures(ws)
      for (const [id, topic] of ws.data.subscriptions.entries()) {
        if (topic.type !== "update") continue
        const envelope = createEnvelope(id, topic, undefined, ws)
        if (envelope.type !== "snapshot") continue
        const signature = JSON.stringify(envelope.snapshot)
        if (snapshotSignatures.get(id) === signature) continue
        snapshotSignatures.set(id, signature)
        send(ws, envelope)
      }
    }
  }) ?? (() => {})

  function pushPtyInstancesEvent(event: PtyInstancesEvent) {
    for (const ws of sockets) {
      for (const [id, topic] of ws.data.subscriptions.entries()) {
        if (topic.type !== "pty-instances") continue
        send(ws, { v: PROTOCOL_VERSION, type: "event", id, event })
      }
    }
  }

  const disposePtyInstances: () => void = ptyInstances?.subscribe((delta: PtyInstanceDelta) => {
    if (delta.type === "added") {
      pushPtyInstancesEvent({ type: "pty-instances.added", instance: delta.instance })
    } else if (delta.type === "updated") {
      pushPtyInstancesEvent({ type: "pty-instances.updated", instance: delta.instance })
    } else {
      pushPtyInstancesEvent({ type: "pty-instances.removed", chatId: delta.chatId })
    }
  }) ?? (() => {})

  const disposeWorkflows: () => void = workflowRegistry?.subscribe((chatId) => {
    for (const ws of sockets) {
      const snapshotSignatures = ensureSnapshotSignatures(ws)
      for (const [id, topic] of ws.data.subscriptions.entries()) {
        if (topic.type !== "workflows" || topic.chatId !== chatId) continue
        const envelope = createEnvelope(id, topic, undefined, ws)
        if (envelope.type !== "snapshot") continue
        const signature = JSON.stringify(envelope.snapshot)
        if (snapshotSignatures.get(id) === signature) continue
        snapshotSignatures.set(id, signature)
        send(ws, envelope)
      }
    }
  }) ?? (() => {})

  const pushOrchRuns = () => {
    for (const ws of sockets) {
      const snapshotSignatures = ensureSnapshotSignatures(ws)
      for (const [id, topic] of ws.data.subscriptions.entries()) {
        if (topic.type !== "orch-runs") continue
        const envelope = createEnvelope(id, topic, undefined, ws)
        if (envelope.type !== "snapshot") continue
        const signature = JSON.stringify(envelope.snapshot)
        if (snapshotSignatures.get(id) === signature) continue
        snapshotSignatures.set(id, signature)
        send(ws, envelope)
      }
    }
  }
  // Optional like the registry subscriptions above: partial store fakes in
  // tests may not implement it. The real EventStore always does.
  const disposeOrchRuns: () => void = typeof store.subscribeOrchRuns === "function"
    ? store.subscribeOrchRuns(pushOrchRuns)
    : () => {}

  agent.setBackgroundErrorReporter?.(broadcastError)

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
              broadcastChatAndSidebar,
              broadcastSidebar: () => broadcastFilteredSnapshots({ includeSidebar: true }),
              broadcastAll: broadcastSnapshots,
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
              broadcastChatAndSidebar,
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
              broadcastChatAndSidebar,
              broadcastSidebar: () => broadcastFilteredSnapshots({ includeSidebar: true }),
              broadcastAll: broadcastSnapshots,
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
              broadcastSnapshots,
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
              broadcastChatAndSidebar,
              broadcastSidebar: () => broadcastFilteredSnapshots({ includeSidebar: true }),
              broadcastAll: broadcastSnapshots,
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
              broadcastSidebar: () => broadcastFilteredSnapshots({ includeSidebar: true }),
              broadcastChatAndSidebar,
              pushTerminalSnapshot,
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
              broadcastPushConfig: () => broadcastFilteredSnapshots({ includePushConfig: true }),
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
              broadcastChatAndSidebar,
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
              broadcastSidebar: () => broadcastFilteredSnapshots({ includeSidebar: true }),
              broadcastChatAndSidebar,
              pushTerminalSnapshot,
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
              broadcastSidebar: () => broadcastFilteredSnapshots({ includeSidebar: true }),
            },
            command,
            id,
          )
          return
        }
      }

      await broadcastSnapshots()
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
      sockets.add(ws)
    },
    handleClose(ws: ServerWebSocket<ClientState>) {
      if (ws.data.pushDeviceId) {
        pushManager.clearFocus(ws.data.pushDeviceId)
      }
      sockets.delete(ws)
    },
    broadcastSnapshots,
    broadcastChatStateImmediately,
    scheduleBroadcast,
    scheduleChatStateBroadcast,
    pruneStaleEmptyChats: () => maybePruneStaleEmptyChats(),
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
              void pushSnapshots(ws, { skipPrune: true })
            }
          })
          return
        }
        await pushSnapshots(ws, { skipPrune: true })
        return
      }

      if (parsed.type === "unsubscribe") {
        const snapshotSignatures = ensureSnapshotSignatures(ws)
        ws.data.subscriptions.delete(parsed.id)
        snapshotSignatures.delete(parsed.id)
        send(ws, { v: PROTOCOL_VERSION, type: "ack", id: parsed.id })
        return
      }

      await handleCommand(ws, parsed)
    },
    dispose() {
      if (pendingBroadcastTimer) {
        clearTimeout(pendingBroadcastTimer)
      }
      agent.setBackgroundErrorReporter?.(null)
      disposeTerminalEvents()
      disposeKeybindingEvents()
      disposeAppSettingsEvents()
      disposeUpdateEvents()
      disposePtyInstances()
      disposeWorkflows()
      disposeOrchRuns()
    },
  }
}
