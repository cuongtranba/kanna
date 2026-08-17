/**
 * useAppGlobalState — app-wide socket subscriptions, UI-restart machinery,
 * focus/visibility listeners, and settings/MCP/LLM + sidebar/project/stack/
 * import handlers.
 *
 * Called exactly once by useKannaState; its result is spread into the
 * KannaState return. KannaState stays byte-identical; no consumer changes.
 */

import { useCallback, useEffect, useMemo, useRef } from "react"
import { useShallow } from "zustand/react/shallow"
import { type ChatNavigatorPort } from "./chatNavigator"
import { type AppSettingsPatch, type AppSettingsSnapshot, type ClaudeAuthSettings, type KeybindingsSnapshot, type LlmProviderSnapshot, type LlmProviderValidationResult, type OpenRouterModel, type PushConfigSnapshot, type UpdateInstallResult, type UpdateSnapshot } from "../../shared/types"
import type { ChatDiffSnapshot, ChatSnapshot, CloudflareTunnelSettings, GitWorktree, LocalProjectsSnapshot, ProjectCommandsSnapshot, SidebarChatRow, SidebarData, StackSummary } from "../../shared/types"
import { NEW_CHAT_COMPOSER_ID, useChatPreferencesStore } from "../stores/chatPreferencesStore"
import { useRightSidebarStore } from "../stores/rightSidebarStore"
import { useTerminalLayoutStore } from "../stores/terminalLayoutStore"
import { useTerminalPreferencesStore } from "../stores/terminalPreferencesStore"
import { useAppSettingsStore } from "../stores/appSettingsStore"
import { useChatSoundPreferencesStore } from "../stores/chatSoundPreferencesStore"
import { useAppDialog } from "../components/ui/app-dialog"
import type { EditorOpenSettings, ImportSessionsByIdsResult, OpenExternalAction, PtyInstancesEvent } from "../../shared/protocol"
import type { PtyInstancesSnapshot } from "../../shared/pty-instance"
import type { FollowedSessionsSnapshot } from "../../shared/protocol"
import type { CronJobsGlobalSnapshot } from "../../shared/cron/types"
import type { ChatPermissionPolicyOverride } from "../../shared/permission-policy"
import { usePtyInstancesStore } from "../stores/ptyInstancesStore"
import { useFollowedSessionsStore } from "../stores/followedSessionsStore"
import { useCronJobsStore } from "../stores/cronJobsStore"
import { useOpenRouterModelsStore } from "../stores/openrouterModelsStore"
import { gitSnapshotKey, useKannaStateStore } from "../stores/kannaStateStore"
import { usePaneLayoutStore } from "../stores/paneLayoutStore"
import { collectPanes } from "../lib/paneTree"
import { useSlashCommandsStore } from "../stores/slashCommandsStore"
import { isRecord } from "../../shared/errors"
import type { AnyValue } from "../../shared/errors"
import type { StoragePort } from "../ports/storagePort"
import type { DomPort } from "../ports/domPort"
import type { TimerPort } from "../ports/timerPort"
import type { ClipboardPort } from "../ports/clipboardPort"
import { postAuthLogout, fetchAuthStatus } from "../api/auth"
import type { KannaSocket, SocketStatus } from "./socket"
import { sameDiffs, shouldPreserveExistingProjectDiffs, UpdateRestartRuntime } from "./appRuntime"
import type { OpenLocalLinkTarget } from "../components/messages/shared"

// ---------------------------------------------------------------------------
// Storage keys (private)
// ---------------------------------------------------------------------------

const LEGACY_THEME_STORAGE_KEY = "lever-theme"
const LEGACY_CHAT_SOUND_STORAGE_KEY = "chat-sound-preferences"
const LEGACY_TERMINAL_STORAGE_KEY = "terminal-preferences"
const LEGACY_CHAT_PREFERENCES_STORAGE_KEY = "chat-preferences"

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function readPersistedZustandState(key: string, storage: StoragePort): Record<string, unknown> | null {
  const raw = storage.getItem(key)
  if (!raw) return null
  try {
    const parsed: { state?: AnyValue } = JSON.parse(raw)
    return isRecord(parsed.state) ? parsed.state : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// project-git / project-commands subscription helpers
// ---------------------------------------------------------------------------

function applyProjectCommandsSnapshotLocal(
  subscribedProjectId: string,
  snapshot: ProjectCommandsSnapshot | null,
): void {
  if (!snapshot || snapshot.projectId !== subscribedProjectId) return
  useSlashCommandsStore.getState().setForProject(snapshot.projectId, snapshot.commands)
}

function readLegacyBrowserSettingsPatch(storage: StoragePort): AppSettingsPatch | null {
  const patch: AppSettingsPatch = {}
  const theme = storage.getItem(LEGACY_THEME_STORAGE_KEY)
  if (theme === "light" || theme === "dark" || theme === "system") {
    patch.theme = theme
  }

  const chatSoundState = readPersistedZustandState(LEGACY_CHAT_SOUND_STORAGE_KEY, storage)
  if (chatSoundState?.chatSoundPreference === "never" || chatSoundState?.chatSoundPreference === "unfocused" || chatSoundState?.chatSoundPreference === "always") {
    patch.chatSoundPreference = chatSoundState.chatSoundPreference
  }
  if (
    chatSoundState?.chatSoundId === "blow"
    || chatSoundState?.chatSoundId === "bottle"
    || chatSoundState?.chatSoundId === "frog"
    || chatSoundState?.chatSoundId === "funk"
    || chatSoundState?.chatSoundId === "glass"
    || chatSoundState?.chatSoundId === "ping"
    || chatSoundState?.chatSoundId === "pop"
    || chatSoundState?.chatSoundId === "purr"
    || chatSoundState?.chatSoundId === "tink"
  ) {
    patch.chatSoundId = chatSoundState.chatSoundId
  }

  const terminalState = readPersistedZustandState(LEGACY_TERMINAL_STORAGE_KEY, storage)
  if (terminalState) {
    patch.terminal = {}
    if (typeof terminalState.scrollbackLines === "number") {
      patch.terminal.scrollbackLines = terminalState.scrollbackLines
    }
    if (typeof terminalState.minColumnWidth === "number") {
      patch.terminal.minColumnWidth = terminalState.minColumnWidth
    }
    const editorPatch: NonNullable<AppSettingsPatch["editor"]> = {}
    if (
      terminalState.editorPreset === "cursor"
      || terminalState.editorPreset === "vscode"
      || terminalState.editorPreset === "xcode"
      || terminalState.editorPreset === "windsurf"
      || terminalState.editorPreset === "custom"
    ) {
      editorPatch.preset = terminalState.editorPreset
    }
    if (typeof terminalState.editorCommandTemplate === "string") {
      editorPatch.commandTemplate = terminalState.editorCommandTemplate
    }
    if (Object.keys(editorPatch).length > 0) {
      patch.editor = editorPatch
    }
  }

  const chatPreferencesState = readPersistedZustandState(LEGACY_CHAT_PREFERENCES_STORAGE_KEY, storage)
  if (chatPreferencesState?.defaultProvider === "last_used" || chatPreferencesState?.defaultProvider === "claude" || chatPreferencesState?.defaultProvider === "codex") {
    patch.defaultProvider = chatPreferencesState.defaultProvider
  }
  if (isRecord(chatPreferencesState?.providerDefaults)) {
    // Legacy migration: providerDefaults stored as opaque Record; checked via isRecord above
    const legacyProviderDefaults: AppSettingsPatch["providerDefaults"] = chatPreferencesState.providerDefaults
    patch.providerDefaults = legacyProviderDefaults
  }

  patch.browserSettingsMigrated = true
  return Object.keys(patch).length > 1 ? patch : null
}

function clearLegacyBrowserSettings(storage: StoragePort) {
  storage.removeItem(LEGACY_THEME_STORAGE_KEY)
  storage.removeItem(LEGACY_CHAT_SOUND_STORAGE_KEY)
  storage.removeItem(LEGACY_TERMINAL_STORAGE_KEY)
  storage.removeItem(LEGACY_CHAT_PREFERENCES_STORAGE_KEY)
}

function syncRuntimeStoresFromAppSettings(snapshot: AppSettingsSnapshot) {
  useAppSettingsStore.getState().setFromServer(snapshot)
  const terminalPreferences = useTerminalPreferencesStore.getState()
  terminalPreferences.setScrollbackLines(snapshot.terminal.scrollbackLines)
  terminalPreferences.setMinColumnWidth(snapshot.terminal.minColumnWidth)
  terminalPreferences.setEditorPreset(snapshot.editor.preset)
  terminalPreferences.setEditorCommandTemplate(snapshot.editor.commandTemplate)

  const chatSoundPreferences = useChatSoundPreferencesStore.getState()
  chatSoundPreferences.setChatSoundPreference(snapshot.chatSoundPreference)
  chatSoundPreferences.setChatSoundId(snapshot.chatSoundId)

  useChatPreferencesStore.getState().applyServerDefaults(
    snapshot.defaultProvider,
    snapshot.providerDefaults
  )
}


// ---------------------------------------------------------------------------
// Exported pure helpers (consumers may import these)
// ---------------------------------------------------------------------------

export function applySidebarProjectOrder(
  projectGroups: SidebarData["projectGroups"],
  projectIds: string[] | null | undefined
) {
  if (!projectIds?.length || projectGroups.length <= 1) {
    return projectGroups
  }

  const indexByProjectId = new Map(projectGroups.map((group, index) => [group.groupKey, index]))
  const seen = new Set<string>()
  const orderedGroups = projectIds
    .map((projectId) => {
      if (seen.has(projectId)) {
        return null
      }
      seen.add(projectId)
      const index = indexByProjectId.get(projectId)
      return index === undefined ? null : projectGroups[index]
    })
    .filter((group): group is SidebarData["projectGroups"][number] => Boolean(group))

  if (orderedGroups.length === 0) {
    return projectGroups
  }

  const nextProjectGroups = [
    ...orderedGroups,
    ...projectGroups.filter((group) => !seen.has(group.groupKey)),
  ]

  return nextProjectGroups.every((group, index) => group === projectGroups[index])
    ? projectGroups
    : nextProjectGroups
}

export function getNewestRemainingChatId(projectGroups: SidebarData["projectGroups"], activeChatId: string): string | null {
  const projectGroup = projectGroups.find((group) => group.chats.some((chat) => chat.chatId === activeChatId))
  if (!projectGroup) return null

  return projectGroup.chats.find((chat) => chat.chatId !== activeChatId)?.chatId ?? null
}

/** Which project a chat belongs to, per the sidebar grouping. */
export function getProjectIdForChat(
  projectGroups: SidebarData["projectGroups"],
  chatId: string | null,
): string | null {
  if (!chatId) return null
  return projectGroups.find((group) => group.chats.some((chat) => chat.chatId === chatId))?.groupKey ?? null
}

export function getUiUpdateRestartReconnectAction(
  phase: string | null,
  connectionStatus: SocketStatus
): "none" | "awaiting_server_ready" {
  if (phase === "awaiting_disconnect" && connectionStatus === "disconnected") {
    return "awaiting_server_ready"
  }

  return "none"
}

export interface UiRestartActivity {
  active: boolean
  label: string
}

export function deriveUiRestartActivity(
  phase: string | null,
  updateStatus: UpdateSnapshot["status"] | null | undefined
): UiRestartActivity {
  if (updateStatus === "updating" || updateStatus === "restart_pending") {
    return { active: true, label: "Installing update" }
  }
  if (phase === "awaiting_disconnect" || phase === "awaiting_server_ready") {
    return { active: true, label: "Re-deploying Kanna" }
  }
  return { active: false, label: "" }
}

export function shouldHandleUiUpdateReloadRequest(
  reloadRequestedAt: number | null | undefined,
  lastHandledReloadRequest: string | null
) {
  if (!reloadRequestedAt) return false
  return String(reloadRequestedAt) !== lastHandledReloadRequest
}

export function getUiUpdateReadinessPath() {
  return "/auth/status"
}

export interface ProjectRequest {
  mode: "new" | "existing"
  localPath: string
  title: string
}

export type StartChatIntent =
  | { kind: "project_id"; projectId: string }
  | { kind: "local_path"; localPath: string }
  | { kind: "project_request"; project: ProjectRequest }

export function resolveComposeIntent(params: {
  selectedProjectId: string | null
  sidebarProjectId?: string | null
  fallbackLocalProjectPath?: string | null
}): StartChatIntent | null {
  const projectId = params.selectedProjectId ?? params.sidebarProjectId ?? null
  if (projectId) {
    return { kind: "project_id", projectId }
  }

  if (params.fallbackLocalProjectPath) {
    return { kind: "local_path", localPath: params.fallbackLocalProjectPath }
  }

  return null
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface AppGlobalState {
  socket: KannaSocket
  /**
   * The chatId in the URL, from the provider's single useParams() call.
   *
   * Deliberately NOT named activeChatId: a useKannaState instance calls its own
   * chatId parameter that, and conflating the two is what let the primary-tab
   * gate be written as isPrimaryChatInstance(x, x) — always true, guarding
   * nothing. This is the ROUTE's chat; an instance's is its own.
   */
  routeChatId: string | null
  sidebarData: SidebarData
  localProjects: LocalProjectsSnapshot | null
  updateSnapshot: UpdateSnapshot | null
  keybindings: KeybindingsSnapshot | null
  appSettings: AppSettingsSnapshot | null
  pushConfig: PushConfigSnapshot | null
  llmProvider: LlmProviderSnapshot | null
  connectionStatus: SocketStatus
  sidebarReady: boolean
  uiRestartActive: boolean
  uiRestartLabel: string
  localProjectsReady: boolean
  commandError: string | null
  startingLocalPath: string | null
  sidebarOpen: boolean
  sidebarCollapsed: boolean
  addProjectModalOpen: boolean
  stacks: StackSummary[]
  openSidebar: () => void
  closeSidebar: () => void
  collapseSidebar: () => void
  expandSidebar: () => void
  openAddProjectModal: () => void
  closeAddProjectModal: () => void
  handleCreateChat: (projectId: string) => Promise<void>
  handleForkChat: (chat: SidebarChatRow) => Promise<void>
  handleOpenLocalProject: (localPath: string) => Promise<void>
  handleCreateProject: (project: ProjectRequest) => Promise<void>
  handleCheckForUpdates: (options?: { force?: boolean }) => Promise<void>
  handleInstallUpdate: (version?: string) => Promise<void>
  handleForceReload: () => Promise<void>
  handleReadAppSettings: () => Promise<void>
  handleWriteAppSettings: (patch: AppSettingsPatch) => Promise<void>
  handleTestMcpServer: (id: string) => Promise<void>
  handleStartMcpOAuth: (id: string) => Promise<{ ok: boolean; authorizationUrl?: string; alreadyAuthenticated?: boolean; error?: string }>
  handleCompleteMcpOAuth: (id: string, callbackUrl: string) => Promise<{ ok: boolean; error?: string }>
  handleSetChatPolicyOverride: (chatId: string, policyOverride: ChatPermissionPolicyOverride | null) => Promise<void>
  handleWriteCloudflareTunnel: (patch: Partial<CloudflareTunnelSettings>) => Promise<void>
  handleWriteClaudeAuth: (patch: Partial<ClaudeAuthSettings>) => Promise<void>
  handleTestOAuthToken: (token: string) => Promise<{ ok: boolean; error: string | null }>
  handleReadLlmProvider: () => Promise<void>
  handleWriteLlmProvider: (value: Pick<LlmProviderSnapshot, "provider" | "apiKey" | "model" | "baseUrl">) => Promise<void>
  handleValidateLlmProvider: (value: Pick<LlmProviderSnapshot, "provider" | "apiKey" | "model" | "baseUrl">) => Promise<LlmProviderValidationResult>
  handleSignOut: () => Promise<void>
  handleRenameChat: (chat: SidebarChatRow) => Promise<void>
  handleArchiveChat: (chat: SidebarChatRow) => Promise<void>
  handleOpenArchivedChat: (chatId: string) => Promise<void>
  handleDeleteChat: (chat: SidebarChatRow) => Promise<void>
  handleHideProject: (projectId: string) => Promise<void>
  handleToggleProjectStar: (projectId: string, starred: boolean) => Promise<void>
  handleReorderProjectGroups: (projectIds: string[]) => Promise<void>
  handleCreateStack: (title: string, projectIds: string[]) => Promise<void>
  handleRenameStack: (stackId: string, title: string) => Promise<void>
  handleRemoveStack: (stackId: string) => Promise<void>
  handleAddProjectToStack: (stackId: string, projectId: string) => Promise<void>
  handleRemoveProjectFromStack: (stackId: string, projectId: string) => Promise<void>
  handleCreateStackChat: (primaryProjectId: string, stackId: string, stackBindings: Array<{ projectId: string; worktreePath: string; role: "primary" | "additional" }>) => Promise<void>
  handleListStackWorktrees: (projectId: string) => Promise<GitWorktree[]>
  importClaudeSessions: () => Promise<{ imported: number; updated: number; skipped: number; failed: number; newProjects: number }>
  importClaudeSession: (sessionIds: string[]) => Promise<ImportSessionsByIdsResult>
  handleCopyPath: (localPath: string) => Promise<void>
  handleOpenExternal: (action: OpenExternalAction, editor?: EditorOpenSettings) => Promise<void>
  handleOpenExternalPath: (action: "open_finder" | "open_editor", localPath: string) => Promise<void>
  handleOpenLocalLink: (target: OpenLocalLinkTarget, action?: OpenExternalAction, editor?: EditorOpenSettings) => Promise<void>
  handleCompose: () => void
  chatNavigator: ChatNavigatorPort
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAppGlobalState(
  socket: KannaSocket,
  localStore: StoragePort,
  sessStore: StoragePort,
  dom: DomPort,
  timer: TimerPort,
  clipboard: ClipboardPort,
  activeChatId: string | null,
  runtime: ChatSnapshot["runtime"] | null,
  chatNavigator: ChatNavigatorPort,
): AppGlobalState {
  const dialog = useAppDialog()

  // ---- store reads -------------------------------------------------------

  const sidebarData = useKannaStateStore((state) => state.sidebarData)
  const optimisticSidebarProjectOrder = useKannaStateStore((state) => state.optimisticSidebarProjectOrder)
  const localProjects = useKannaStateStore((state) => state.localProjects)
  const updateSnapshot = useKannaStateStore((state) => state.updateSnapshot)
  const uiRestartPhase = useKannaStateStore((state) => state.uiRestartPhase)
  const keybindings = useKannaStateStore((state) => state.keybindings)
  const appSettings = useKannaStateStore((state) => state.appSettings)
  const pushConfig = useKannaStateStore((state) => state.pushConfig)
  const llmProvider = useKannaStateStore((state) => state.llmProvider)
  const connectionStatus = useKannaStateStore((state) => state.connectionStatus)
  const sidebarReady = useKannaStateStore((state) => state.sidebarReady)
  const localProjectsReady = useKannaStateStore((state) => state.localProjectsReady)
  const sidebarOpen = useKannaStateStore((state) => state.sidebarOpen)
  const sidebarCollapsed = useKannaStateStore((state) => state.sidebarCollapsed)
  const addProjectModalOpen = useKannaStateStore((state) => state.addProjectModalOpen)
  const commandError = useKannaStateStore((state) => state.commandError)
  const startingLocalPath = useKannaStateStore((state) => state.startingLocalPath)
  // Internal reads (not in return type):
  const selectedProjectId = useKannaStateStore((state) => state.selectedProjectId)
  // Chats with an open tab in the workspace. The workspace is ONE tree shared by
  // every project now, so the set of open projects is derived from the chat tabs
  // themselves rather than from per-project layout keys — that is what keeps
  // project A's subscriptions alive while you read a chat in project B.
  const openChatTabIds = usePaneLayoutStore(
    useShallow((state) =>
      collectPanes(state.layout.root)
        .flatMap((pane) => pane.tabs)
        .flatMap((tab) => (tab.target.kind === "chat" ? [tab.target.chatId] : [])),
    ),
  )
  const runtimeProjectId = runtime?.projectId ?? null

  // ---- derived -----------------------------------------------------------

  const updateRestartRuntimeRef = useRef<UpdateRestartRuntime | null>(null)

  useEffect(() => {
    const rt = new UpdateRestartRuntime(
      {
        storage: sessStore,
        dom,
        timer,
        onSnapshot: (snap) => {
          useKannaStateStore.getState().setUiRestartPhase(snap.phase === "idle" ? null : snap.phase)
        },
      },
      {
        isServerReady: async () => {
          const result = await fetchAuthStatus()
          return Object.keys(result).length > 0
        },
      },
    )
    updateRestartRuntimeRef.current = rt
    return () => {
      rt.close()
      updateRestartRuntimeRef.current = null
    }
  }, [dom, sessStore, timer])

  useEffect(() => {
    updateRestartRuntimeRef.current?.dispatch({
      kind: "update_status_changed",
      updateStatus: updateSnapshot?.status,
    })
  }, [updateSnapshot?.status])

  useEffect(() => {
    const rt = updateRestartRuntimeRef.current
    if (!rt || !updateSnapshot?.reloadRequestedAt) return
    rt.dispatch({
      kind: "reload_requested",
      reloadRequestedAt: updateSnapshot.reloadRequestedAt,
      lastHandled: UpdateRestartRuntime.getLastHandledReloadRequest(sessStore),
    })
  }, [sessStore, updateSnapshot?.reloadRequestedAt])

  useEffect(() => {
    updateRestartRuntimeRef.current?.dispatch({
      kind: "connection_status_changed",
      connectionStatus,
    })
  }, [connectionStatus])

  const markUiRestartPhase = useCallback((_phase: "awaiting_disconnect" | "awaiting_server_ready") => {
    updateRestartRuntimeRef.current?.dispatch({ kind: "update_initiated" })
  }, [])

  const clearUiRestartPhase = useCallback(() => {
    updateRestartRuntimeRef.current?.dispatch({ kind: "aborted" })
  }, [])

  const sidebarProjectGroups = useMemo(
    () => applySidebarProjectOrder(sidebarData.projectGroups, optimisticSidebarProjectOrder),
    [optimisticSidebarProjectOrder, sidebarData.projectGroups]
  )

  const resolvedSidebarData = useMemo(
    () => (
      sidebarProjectGroups === sidebarData.projectGroups
        ? sidebarData
        : {
            ...sidebarData,
            projectGroups: sidebarProjectGroups,
          }
    ),
    [sidebarData, sidebarProjectGroups]
  )

  const fallbackLocalProjectPath = localProjects?.projects[0]?.localPath ?? null

  // ---- socket subscriptions (global topics) ------------------------------

  useEffect(() => socket.onStatus((status) => useKannaStateStore.getState().setConnectionStatus(status)), [socket])

  useEffect(() => {
    return socket.subscribe<SidebarData>({ type: "sidebar" }, (snapshot) => {
      const store = useKannaStateStore.getState()
      store.setSidebarData(snapshot)
      store.setOptimisticSidebarProjectOrder((current) => (
        current && applySidebarProjectOrder(snapshot.projectGroups, current) === snapshot.projectGroups
          ? null
          : current
      ))
      store.setSidebarReady(true)
      store.setCommandError(null)
    })
  }, [socket])

  useEffect(() => {
    return socket.subscribe<LocalProjectsSnapshot>({ type: "local-projects" }, (snapshot) => {
      const store = useKannaStateStore.getState()
      store.setLocalProjects(snapshot)
      store.setLocalProjectsReady(true)
      store.setCommandError(null)
    })
  }, [socket])

  useEffect(() => {
    return socket.subscribe<UpdateSnapshot>({ type: "update" }, (snapshot) => {
      const store = useKannaStateStore.getState()
      store.setUpdateSnapshot(snapshot)
      store.setCommandError(null)
    })
  }, [socket])

  useEffect(() => {
    return socket.subscribe<KeybindingsSnapshot>({ type: "keybindings" }, (snapshot) => {
      const store = useKannaStateStore.getState()
      store.setKeybindings(snapshot)
      store.setCommandError(null)
    })
  }, [socket])

  useEffect(() => {
    return socket.subscribe<AppSettingsSnapshot>({ type: "app-settings" }, (snapshot) => {
      const store = useKannaStateStore.getState()
      store.setAppSettings(snapshot)
      syncRuntimeStoresFromAppSettings(snapshot)
      store.setCommandError(null)
    })
  }, [socket])

  useEffect(() => {
    return socket.subscribe<PushConfigSnapshot>({ type: "push-config" }, (snapshot) => {
      useKannaStateStore.getState().setPushConfig(snapshot)
    })
  }, [socket])

  useEffect(() => {
    return socket.subscribe<PtyInstancesSnapshot, PtyInstancesEvent>(
      { type: "pty-instances" },
      (snapshot) => {
        usePtyInstancesStore.getState().applySnapshot(snapshot.instances)
      },
      (event) => {
        if (event.type === "pty-instances.added") {
          usePtyInstancesStore.getState().applyDiff({ op: "added", instance: event.instance })
        } else if (event.type === "pty-instances.updated") {
          usePtyInstancesStore.getState().applyDiff({ op: "updated", instance: event.instance })
        } else {
          usePtyInstancesStore.getState().applyDiff({ op: "removed", chatId: event.chatId })
        }
      },
    )
  }, [socket])

  useEffect(() => {
    return socket.subscribe<FollowedSessionsSnapshot>({ type: "followed-sessions" }, (snapshot) => {
      useFollowedSessionsStore.getState().setFollowed(snapshot.chatIds)
    })
  }, [socket])

  useEffect(() => {
    return socket.subscribe<CronJobsGlobalSnapshot>({ type: "cron-jobs" }, (snapshot) => {
      useCronJobsStore.getState().setRows(snapshot.rows)
    })
  }, [socket])

  // ---- project-level subscriptions (once per distinct open projectId) ------
  //
  // Subscribing in useAppGlobalState (rather than useKannaState) ensures that
  // switching the active chat never tears down a subscription for a project
  // that is still open in another pane/tab.  The set of open projectIds comes
  // from three sources — all scalar or useShallow-stable — so the effect only
  // fires when a project is actually added or removed.

  useEffect(() => {
    const ids = new Set<string>()
    // Git state is subscribed per CHAT, because a chat can run in a worktree of
    // its project and therefore have its own branch and its own dirty files.
    // A project with no open chat still gets one subscription for its checkout.
    const gitTargets = new Map<string, { projectId: string; chatId?: string }>()
    for (const chatId of openChatTabIds) {
      const chatProjectId = getProjectIdForChat(sidebarProjectGroups, chatId)
      if (!chatProjectId) continue
      ids.add(chatProjectId)
      gitTargets.set(gitSnapshotKey(chatProjectId, chatId), { projectId: chatProjectId, chatId })
    }
    if (selectedProjectId) ids.add(selectedProjectId)
    if (runtimeProjectId) ids.add(runtimeProjectId)
    for (const projectId of ids) {
      if (!gitTargets.has(projectId)) gitTargets.set(projectId, { projectId })
    }

    if (ids.size === 0) return

    const cleanups: (() => void)[] = []

    gitTargets.forEach(({ projectId, chatId }, key) => {
      cleanups.push(
        socket.subscribe<ChatDiffSnapshot | null>(
          { type: "project-git", projectId, ...(chatId === undefined ? {} : { chatId }) },
          (snapshot) => {
            useKannaStateStore.getState().setDiffSnapshotsByKey((current) => {
              const nextDiffs = snapshot ?? null
              if (shouldPreserveExistingProjectDiffs(current[key] ?? null, nextDiffs)) return current
              if (sameDiffs(current[key] ?? null, nextDiffs)) return current
              return { ...current, [key]: nextDiffs }
            })
            useKannaStateStore.getState().setCommandError(null)
          },
        ),
      )
    })

    ids.forEach((projectId) => {
      // The composer picker's catalog is per project, so it is fetched once
      // per project rather than per chat — opening another chat in the same
      // project renders the list from cache with no round trip.
      cleanups.push(
        socket.subscribe<ProjectCommandsSnapshot>(
          { type: "project-commands", projectId },
          (snapshot) => { applyProjectCommandsSnapshotLocal(projectId, snapshot) },
        ),
      )
    })

    return () => { cleanups.forEach((fn) => fn()) }
  }, [openChatTabIds, sidebarProjectGroups, runtimeProjectId, selectedProjectId, socket])

  // ---- update / UI-restart effects ---------------------------------------

  useEffect(() => {
    if (connectionStatus !== "connected") return
    void socket.command<UpdateSnapshot>({ type: "update.check", force: true }).catch((error) => {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    })
  }, [connectionStatus, socket])

  // ---- focus / visibility effects ----------------------------------------

  useEffect(() => {
    function handleWindowFocus() {
      if (!updateSnapshot?.lastCheckedAt) return
      if (Date.now() - updateSnapshot.lastCheckedAt <= 60 * 60 * 1000) return
      void socket.command<UpdateSnapshot>({ type: "update.check" }).catch((error) => {
        useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
      })
    }

    return dom.addWindowListener("focus", handleWindowFocus)
  }, [dom, socket, updateSnapshot?.lastCheckedAt])

  useEffect(() => {
    function handleFocusSignal() {
      useKannaStateStore.getState().incrementFocusEpoch()
    }

    const cleanupFocus = dom.addWindowListener("focus", handleFocusSignal)
    const cleanupVisibility = dom.addDocumentListener("visibilitychange", handleFocusSignal)

    return () => {
      cleanupFocus()
      cleanupVisibility()
    }
  }, [dom])

  // ---- settings / LLM on connection -------------------------------------

  const handleReadAppSettings = useCallback(async () => {
    try {
      useAppSettingsStore.getState().setHydrationStatus("loading")
      const snapshot = await socket.command<AppSettingsSnapshot>({ type: "settings.readAppSettings" })
      const store = useKannaStateStore.getState()
      store.setAppSettings(snapshot)
      syncRuntimeStoresFromAppSettings(snapshot)
      store.setCommandError(null)
    } catch (error) {
      useAppSettingsStore.getState().setHydrationStatus("error")
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [socket])

  const handleReadLlmProvider = useCallback(async () => {
    try {
      const snapshot = await socket.command<LlmProviderSnapshot>({ type: "settings.readLlmProvider" })
      const store = useKannaStateStore.getState()
      store.setLlmProvider(snapshot)
      store.setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [socket])

  useEffect(() => {
    if (connectionStatus !== "connected") return
    void handleReadAppSettings()
  }, [connectionStatus, handleReadAppSettings])

  useEffect(() => {
    if (connectionStatus !== "connected") return
    const store = useOpenRouterModelsStore.getState()
    store.setLoading()
    void socket
      .command<OpenRouterModel[]>({ type: "settings.listOpenRouterModels" })
      .then((models) => {
        useOpenRouterModelsStore.getState().setModels(models)
      })
      .catch((error: AnyValue) => {
        const message = error instanceof Error ? error.message : String(error)
        useOpenRouterModelsStore.getState().setError(message)
      })
  }, [connectionStatus, socket])

  const handleWriteAppSettings = useCallback(async (patch: AppSettingsPatch) => {
    try {
      useAppSettingsStore.getState().applyOptimisticPatch(patch)
      const snapshot = await socket.command<AppSettingsSnapshot>({
        type: "settings.writeAppSettingsPatch",
        patch,
      })
      const store = useKannaStateStore.getState()
      store.setAppSettings(snapshot)
      syncRuntimeStoresFromAppSettings(snapshot)
      store.setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
      await handleReadAppSettings()
      throw error
    }
  }, [handleReadAppSettings, socket])

  useEffect(() => {
    if (connectionStatus !== "connected") return
    if (appSettings?.browserSettingsMigrated !== false) return
    const patch = readLegacyBrowserSettingsPatch(localStore)
    if (!patch) return
    void handleWriteAppSettings(patch)
      .then(() => clearLegacyBrowserSettings(localStore))
      .catch(() => undefined)
  }, [appSettings?.browserSettingsMigrated, connectionStatus, handleWriteAppSettings, localStore])

  useEffect(() => {
    if (connectionStatus !== "connected") return
    void handleReadLlmProvider()
  }, [connectionStatus, handleReadLlmProvider])

  // ---- sidebar: auto-select first project --------------------------------

  useEffect(() => {
    if (selectedProjectId) return
    const firstGroup = sidebarProjectGroups[0]
    if (firstGroup) {
      useKannaStateStore.getState().setSelectedProjectId(firstGroup.groupKey)
    }
  }, [selectedProjectId, sidebarProjectGroups])

  // ---- settings / MCP / LLM handlers ------------------------------------

  const handleTestMcpServer = useCallback(async (id: string) => {
    try {
      await socket.command({ type: "settings.testMcpServer", id })
      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
      throw error
    }
  }, [socket])

  const handleStartMcpOAuth = useCallback(async (id: string) => {
    try {
      const result = await socket.command<{ ok: boolean; authorizationUrl?: string; alreadyAuthenticated?: boolean; error?: string }>({
        type: "settings.startMcpOAuth",
        id,
      })
      useKannaStateStore.getState().setCommandError(null)
      return result
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      useKannaStateStore.getState().setCommandError(msg)
      return { ok: false, error: msg }
    }
  }, [socket])

  const handleCompleteMcpOAuth = useCallback(async (id: string, callbackUrl: string) => {
    try {
      const result = await socket.command<{ ok: boolean; error?: string }>({
        type: "settings.completeMcpOAuth",
        id,
        callbackUrl,
      })
      useKannaStateStore.getState().setCommandError(null)
      return result
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      useKannaStateStore.getState().setCommandError(msg)
      return { ok: false, error: msg }
    }
  }, [socket])

  const handleSetChatPolicyOverride = useCallback(async (chatId: string, policyOverride: ChatPermissionPolicyOverride | null) => {
    try {
      await socket.command({ type: "chat.setPolicyOverride", chatId, policyOverride })
      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
      throw error
    }
  }, [socket])

  const handleWriteCloudflareTunnel = useCallback(async (patch: Partial<CloudflareTunnelSettings>) => {
    try {
      useAppSettingsStore.getState().applyOptimisticPatch({ cloudflareTunnel: patch })
      const snapshot = await socket.command<AppSettingsSnapshot>({
        type: "appSettings.setCloudflareTunnel",
        patch,
      })
      const store = useKannaStateStore.getState()
      store.setAppSettings(snapshot)
      syncRuntimeStoresFromAppSettings(snapshot)
      store.setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
      await handleReadAppSettings()
      throw error
    }
  }, [handleReadAppSettings, socket])

  const handleWriteClaudeAuth = useCallback(async (patch: Partial<ClaudeAuthSettings>) => {
    try {
      useAppSettingsStore.getState().applyOptimisticPatch({ claudeAuth: patch })
      const snapshot = await socket.command<AppSettingsSnapshot>({
        type: "appSettings.setClaudeAuth",
        patch,
      })
      const store = useKannaStateStore.getState()
      store.setAppSettings(snapshot)
      syncRuntimeStoresFromAppSettings(snapshot)
      store.setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
      await handleReadAppSettings()
      throw error
    }
  }, [handleReadAppSettings, socket])

  const handleTestOAuthToken = useCallback(async (token: string) => {
    return await socket.command<{ ok: boolean; error: string | null }>({
      type: "appSettings.testOAuthToken",
      token,
    })
  }, [socket])

  const handleWriteLlmProvider = useCallback(async (
    value: Pick<LlmProviderSnapshot, "provider" | "apiKey" | "model" | "baseUrl">
  ) => {
    try {
      const snapshot = await socket.command<LlmProviderSnapshot>({
        type: "settings.writeLlmProvider",
        provider: value.provider,
        apiKey: value.apiKey,
        model: value.model,
        baseUrl: value.baseUrl,
      })
      const store = useKannaStateStore.getState()
      store.setLlmProvider(snapshot)
      store.setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
      throw error
    }
  }, [socket])

  const handleValidateLlmProvider = useCallback(async (
    value: Pick<LlmProviderSnapshot, "provider" | "apiKey" | "model" | "baseUrl">
  ) => {
    return await socket.command<LlmProviderValidationResult>({
      type: "settings.validateLlmProvider",
      provider: value.provider,
      apiKey: value.apiKey,
      model: value.model,
      baseUrl: value.baseUrl,
    })
  }, [socket])

  const handleSignOut = useCallback(async () => {
    try {
      await postAuthLogout()
      useKannaStateStore.getState().setCommandError(null)
      dom.reload()
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [dom])

  // ---- update handlers --------------------------------------------------

  const handleCheckForUpdates = useCallback(async (options?: { force?: boolean }) => {
    try {
      await socket.command<UpdateSnapshot>({ type: "update.check", force: options?.force })
      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [socket])

  const handleInstallUpdate = useCallback(async (version?: string) => {
    markUiRestartPhase("awaiting_disconnect")
    try {
      const result = await socket.command<UpdateInstallResult>({ type: "update.install", version })
      if (!result.ok) {
        clearUiRestartPhase()
        useKannaStateStore.getState().setCommandError(null)
        await dialog.alert({
          title: result.userTitle ?? "Update failed",
          description: result.userMessage ?? "Kanna could not install the update. Try again later.",
          closeLabel: "OK",
        })
        return
      }

      if (result.ok && result.action === "reload") {
        dom.reload()
        return
      }

      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      clearUiRestartPhase()
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [clearUiRestartPhase, dialog, dom, markUiRestartPhase, socket])

  const handleForceReload = useCallback(async () => {
    markUiRestartPhase("awaiting_disconnect")
    try {
      const result = await socket.command<UpdateInstallResult>({ type: "update.reload" })
      if (!result.ok) {
        clearUiRestartPhase()
        useKannaStateStore.getState().setCommandError(null)
        await dialog.alert({
          title: result.userTitle ?? "Re-deploy failed",
          description: result.userMessage ?? "Kanna could not re-deploy. Try again later.",
          closeLabel: "OK",
        })
        return
      }

      if (result.action === "reload") {
        dom.reload()
        return
      }

      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      clearUiRestartPhase()
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [clearUiRestartPhase, dialog, dom, markUiRestartPhase, socket])

  // ---- sidebar / chat / project handlers ---------------------------------

  const createChatForProject = useCallback(async (projectId: string) => {
    const chatPreferences = useChatPreferencesStore.getState()
    const sourceComposerState = activeChatId
      ? chatPreferences.getComposerState(activeChatId)
      : chatPreferences.getComposerState(NEW_CHAT_COMPOSER_ID)
    const result = await socket.command<{ chatId: string }>({ type: "chat.create", projectId })
    chatPreferences.initializeComposerForChat(result.chatId, { sourceState: sourceComposerState })
    const store = useKannaStateStore.getState()
    store.setSelectedProjectId(projectId)
    store.setPendingChatId(result.chatId)
    chatNavigator.openChat(result.chatId)
    store.setSidebarOpen(false)
    store.setCommandError(null)
  }, [activeChatId, chatNavigator, socket])

  const resolveProjectIdForStartChat = useCallback(async (intent: StartChatIntent): Promise<{ projectId: string; localPath?: string }> => {
    if (intent.kind === "project_id") {
      return { projectId: intent.projectId }
    }

    if (intent.kind === "local_path") {
      const result = await socket.command<{ projectId: string }>({ type: "project.open", localPath: intent.localPath })
      return { projectId: result.projectId, localPath: intent.localPath }
    }

    const result = await socket.command<{ projectId: string }>(
      intent.project.mode === "new"
        ? { type: "project.create", localPath: intent.project.localPath, title: intent.project.title }
        : { type: "project.open", localPath: intent.project.localPath }
    )
    return { projectId: result.projectId, localPath: intent.project.localPath }
  }, [socket])

  const startChatFromIntent = useCallback(async (intent: StartChatIntent) => {
    try {
      let localPath: string | null
      if (intent.kind === "project_id") {
        localPath = null
      } else if (intent.kind === "local_path") {
        localPath = intent.localPath
      } else {
        localPath = intent.project.localPath
      }
      if (localPath) {
        useKannaStateStore.getState().setStartingLocalPath(localPath)
      }

      const { projectId } = await resolveProjectIdForStartChat(intent)
      await createChatForProject(projectId)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    } finally {
      useKannaStateStore.getState().setStartingLocalPath(null)
    }
  }, [createChatForProject, resolveProjectIdForStartChat])

  const handleCreateChat = useCallback(async (projectId: string) => {
    await startChatFromIntent({ kind: "project_id", projectId })
  }, [startChatFromIntent])

  const handleForkChat = useCallback(async (chat: SidebarChatRow) => {
    try {
      const result = await socket.command<{ chatId: string }>({
        type: "chat.fork",
        chatId: chat.chatId,
      })
      const chatPreferences = useChatPreferencesStore.getState()
      chatPreferences.initializeComposerForChat(result.chatId, {
        sourceState: chatPreferences.getComposerState(chat.chatId),
      })
      const store = useKannaStateStore.getState()
      store.setPendingChatId(result.chatId)
      chatNavigator.openChat(result.chatId)
      store.setSidebarOpen(false)
      store.setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [chatNavigator, socket])

  const handleOpenLocalProject = useCallback(async (localPath: string) => {
    await startChatFromIntent({ kind: "local_path", localPath })
  }, [startChatFromIntent])

  const handleCreateProject = useCallback(async (project: ProjectRequest) => {
    await startChatFromIntent({ kind: "project_request", project })
  }, [startChatFromIntent])

  const handleRenameChat = useCallback(async (chat: SidebarChatRow) => {
    const title = await dialog.prompt({
      title: "Rename Chat",
      initialValue: chat.title,
      confirmLabel: "Rename",
    })
    if (!title || title === chat.title) return
    try {
      await socket.command({ type: "chat.rename", chatId: chat.chatId, title })
      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [dialog, socket])

  const handleDeleteChat = useCallback(async (chat: SidebarChatRow) => {
    const confirmed = await dialog.confirm({
      title: "Delete Chat",
      description: `Delete "${chat.title}"? This cannot be undone.`,
      confirmLabel: "Delete",
      confirmVariant: "destructive",
    })
    if (!confirmed) return
    try {
      await socket.command({ type: "chat.delete", chatId: chat.chatId })
      if (chat.chatId === activeChatId) {
        const nextChatId = getNewestRemainingChatId(sidebarProjectGroups, chat.chatId)
        if (nextChatId) {
          chatNavigator.openChat(nextChatId)
        } else {
          chatNavigator.closeChat()
        }
      }
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [activeChatId, chatNavigator, dialog, sidebarProjectGroups, socket])

  const handleArchiveChat = useCallback(async (chat: SidebarChatRow) => {
    try {
      await socket.command({ type: "chat.archive", chatId: chat.chatId })
      if (chat.chatId === activeChatId) {
        const nextChatId = getNewestRemainingChatId(sidebarProjectGroups, chat.chatId)
        if (nextChatId) {
          chatNavigator.openChat(nextChatId)
        } else {
          chatNavigator.closeChat()
        }
      }
      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [activeChatId, chatNavigator, sidebarProjectGroups, socket])

  const handleOpenArchivedChat = useCallback(async (chatId: string) => {
    try {
      useKannaStateStore.getState().setPendingChatId(chatId)
      await socket.command({ type: "chat.unarchive", chatId })
      chatNavigator.openChat(chatId)
      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setPendingChatId(null)
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [chatNavigator, socket])

  const handleHideProject = useCallback(async (projectId: string) => {
    try {
      await socket.command({ type: "project.remove", projectId })
      useTerminalLayoutStore.getState().clearProject(projectId)
      useRightSidebarStore.getState().clearProject(projectId)
      if (runtime?.projectId === projectId) {
        chatNavigator.closeChat()
      }
      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [chatNavigator, runtime, socket])

  const handleToggleProjectStar = useCallback(async (projectId: string, starred: boolean) => {
    try {
      await socket.command({ type: "project.setStar", projectId, starred })
      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [socket])

  const handleReorderProjectGroups = useCallback(async (projectIds: string[]) => {
    useKannaStateStore.getState().setOptimisticSidebarProjectOrder(projectIds)
    try {
      await socket.command({ type: "sidebar.reorderProjectGroups", projectIds })
      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setOptimisticSidebarProjectOrder(null)
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [socket])

  // ---- stack handlers ---------------------------------------------------

  const handleCreateStack = useCallback(async (title: string, projectIds: string[]) => {
    try {
      await socket.command({ type: "stack.create", title, projectIds })
      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [socket])

  const handleRenameStack = useCallback(async (stackId: string, title: string) => {
    try {
      await socket.command({ type: "stack.rename", stackId, title })
      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [socket])

  const handleRemoveStack = useCallback(async (stackId: string) => {
    try {
      await socket.command({ type: "stack.remove", stackId })
      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [socket])

  const handleAddProjectToStack = useCallback(async (stackId: string, projectId: string) => {
    try {
      await socket.command({ type: "stack.addProject", stackId, projectId })
      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [socket])

  const handleRemoveProjectFromStack = useCallback(async (stackId: string, projectId: string) => {
    try {
      await socket.command({ type: "stack.removeProject", stackId, projectId })
      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [socket])

  const handleCreateStackChat = useCallback(async (
    primaryProjectId: string,
    stackId: string,
    stackBindings: Array<{ projectId: string; worktreePath: string; role: "primary" | "additional" }>,
  ) => {
    try {
      const chatPreferences = useChatPreferencesStore.getState()
      const sourceComposerState = activeChatId
        ? chatPreferences.getComposerState(activeChatId)
        : chatPreferences.getComposerState(NEW_CHAT_COMPOSER_ID)
      const result = await socket.command<{ chatId: string }>({
        type: "chat.create",
        projectId: primaryProjectId,
        stackId,
        stackBindings,
      })
      chatPreferences.initializeComposerForChat(result.chatId, { sourceState: sourceComposerState })
      const store = useKannaStateStore.getState()
      store.setSelectedProjectId(primaryProjectId)
      store.setPendingChatId(result.chatId)
      chatNavigator.openChat(result.chatId)
      store.setSidebarOpen(false)
      store.setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [activeChatId, chatNavigator, socket])

  const handleListStackWorktrees = useCallback(async (projectId: string): Promise<GitWorktree[]> => {
    try {
      const result = await socket.command<{ worktrees: GitWorktree[] }>({ type: "stack.listWorktrees", projectId })
      useKannaStateStore.getState().setCommandError(null)
      return result.worktrees
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
      return []
    }
  }, [socket])

  // ---- import handlers --------------------------------------------------

  const importClaudeSessions = useCallback(async () => {
    const result = await socket.command<{ imported: number; updated: number; skipped: number; failed: number; newProjects: number }>({ type: "sessions.importClaude" })
    return result
  }, [socket])

  const importClaudeSession = useCallback(async (sessionIds: string[]) => {
    return await socket.command<ImportSessionsByIdsResult>({ type: "sessions.importClaudeSession", sessionIds })
  }, [socket])

  // ---- open-external helpers --------------------------------------------

  const openExternal = useCallback(async (command: {
    action: OpenExternalAction
    localPath: string
    line?: number
    column?: number
    editor?: EditorOpenSettings
  }) => {
    const preferences = useTerminalPreferencesStore.getState()
    useKannaStateStore.getState().setCommandError(null)
    await socket.command({
      type: "system.openExternal",
      ...command,
      editor: command.action === "open_editor"
        ? command.editor ?? {
            preset: preferences.editorPreset,
            commandTemplate: preferences.editorCommandTemplate,
          }
        : undefined,
    })
  }, [socket])

  const handleOpenExternal = useCallback(async (action: OpenExternalAction, editor?: EditorOpenSettings) => {
    const localPath = runtime?.localPath ?? localProjects?.projects[0]?.localPath ?? sidebarProjectGroups[0]?.localPath
    if (!localPath) return
    try {
      await openExternal({
        action,
        localPath,
        editor,
      })
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [localProjects?.projects, openExternal, runtime?.localPath, sidebarProjectGroups])

  const handleCopyPath = useCallback(async (localPath: string) => {
    try {
      await clipboard.writeText(localPath)
      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [clipboard])

  const handleOpenLocalLink = useCallback(async (
    target: OpenLocalLinkTarget,
    action: OpenExternalAction = "open_editor",
    editor?: EditorOpenSettings,
  ) => {
    try {
      await openExternal({
        action,
        localPath: target.path,
        line: target.line,
        column: target.column,
        editor,
      })
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [openExternal])

  const handleOpenExternalPath = useCallback(async (action: "open_finder" | "open_editor", localPath: string) => {
    try {
      await openExternal({
        action,
        localPath,
      })
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [openExternal])

  // ---- sidebar UI -------------------------------------------------------

  const openSidebar = useCallback(() => useKannaStateStore.getState().setSidebarOpen(true), [])
  const closeSidebar = useCallback(() => useKannaStateStore.getState().setSidebarOpen(false), [])
  const collapseSidebar = useCallback(() => useKannaStateStore.getState().setSidebarCollapsed(true), [])
  const expandSidebar = useCallback(() => useKannaStateStore.getState().setSidebarCollapsed(false), [])
  const openAddProjectModal = useCallback(() => useKannaStateStore.getState().setAddProjectModalOpen(true), [])
  const closeAddProjectModal = useCallback(() => useKannaStateStore.getState().setAddProjectModalOpen(false), [])

  // ---- compose ----------------------------------------------------------

  const handleCompose = useCallback(() => {
    const intent = resolveComposeIntent({
      selectedProjectId,
      sidebarProjectId: sidebarProjectGroups[0]?.groupKey,
      fallbackLocalProjectPath,
    })
    if (intent) {
      void startChatFromIntent(intent)
      return
    }

    chatNavigator.goHome()
  }, [chatNavigator, fallbackLocalProjectPath, selectedProjectId, sidebarProjectGroups, startChatFromIntent])

  // ---- derive ui restart ------------------------------------------------

  const uiRestart = deriveUiRestartActivity(uiRestartPhase, updateSnapshot?.status)

  // ---- return -----------------------------------------------------------

  return {
    socket,
    routeChatId: activeChatId,
    sidebarData: resolvedSidebarData,
    localProjects,
    updateSnapshot,
    keybindings,
    appSettings,
    pushConfig,
    llmProvider,
    connectionStatus,
    sidebarReady,
    uiRestartActive: uiRestart.active,
    uiRestartLabel: uiRestart.label,
    localProjectsReady,
    commandError,
    startingLocalPath,
    sidebarOpen,
    sidebarCollapsed,
    addProjectModalOpen,
    stacks: resolvedSidebarData.stacks,
    openSidebar,
    closeSidebar,
    collapseSidebar,
    expandSidebar,
    openAddProjectModal,
    closeAddProjectModal,
    handleCreateChat,
    handleForkChat,
    handleOpenLocalProject,
    handleCreateProject,
    handleCheckForUpdates,
    handleInstallUpdate,
    handleForceReload,
    handleReadAppSettings,
    handleWriteAppSettings,
    handleTestMcpServer,
    handleStartMcpOAuth,
    handleCompleteMcpOAuth,
    handleSetChatPolicyOverride,
    handleWriteCloudflareTunnel,
    handleWriteClaudeAuth,
    handleTestOAuthToken,
    handleReadLlmProvider,
    handleWriteLlmProvider,
    handleValidateLlmProvider,
    handleSignOut,
    handleRenameChat,
    handleArchiveChat,
    handleOpenArchivedChat,
    handleDeleteChat,
    handleHideProject,
    handleToggleProjectStar,
    handleReorderProjectGroups,
    handleCreateStack,
    handleRenameStack,
    handleRemoveStack,
    handleAddProjectToStack,
    handleRemoveProjectFromStack,
    handleCreateStackChat,
    handleListStackWorktrees,
    importClaudeSessions,
    importClaudeSession,
    handleCopyPath,
    handleOpenExternal,
    handleOpenExternalPath,
    handleOpenLocalLink,
    handleCompose,
    chatNavigator,
  }
}

