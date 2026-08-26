import { create } from "zustand"
import type { ChatDiffSnapshot, KeybindingsSnapshot, LlmProviderSnapshot, PushConfigSnapshot, UpdateSnapshot } from "../../shared/types"
import type { LocalProjectsSnapshot, SidebarData } from "../../shared/types"
import { sessionStorageAdapter } from "../adapters/storage.adapter"
import type { SocketStatus } from "../app/socket"
import type { OptimisticUserPrompt } from "../app/useKannaState"
import type { StoragePort } from "../ports/storagePort"

// Stable empty refs — NEVER use inline ?? [] or ?? {} in selectors (React error #185)
export const EMPTY_OPTIMISTIC_PROMPTS: OptimisticUserPrompt[] = []
export const EMPTY_DIFF_SNAPSHOTS: Record<string, ChatDiffSnapshot | null> = {}

/** The key a chat's (or a bare project's) git snapshot is stored and read under. */
export function gitSnapshotKey(projectId: string, chatId?: string | null): string {
  return chatId ?? projectId
}
export const EMPTY_SIDEBAR_DATA: SidebarData = { starredProjectGroups: [], projectGroups: [], stacks: [] }

interface KannaStateStoreState {
  sidebarData: SidebarData
  optimisticSidebarProjectOrder: string[] | null
  localProjects: LocalProjectsSnapshot | null
  updateSnapshot: UpdateSnapshot | null
  uiRestartPhase: string | null
  /**
   * Git state keyed by {@link gitSnapshotKey} — a chat id when the snapshot is
   * a chat's own tree, a project id when it is the project's checkout.
   *
   * Not keyed by project: a chat can run in a git worktree, so two chats in one
   * project can sit on different branches with different dirty files. One slot
   * per project showed the second chat the first one's tree.
   */
  diffSnapshotsByKey: Record<string, ChatDiffSnapshot | null>
  keybindings: KeybindingsSnapshot | null
  pushConfig: PushConfigSnapshot | null
  llmProvider: LlmProviderSnapshot | null
  connectionStatus: SocketStatus
  sidebarReady: boolean
  localProjectsReady: boolean
  selectedProjectId: string | null
  sidebarOpen: boolean
  sidebarCollapsed: boolean
  addProjectModalOpen: boolean
  commandError: string | null
  startingLocalPath: string | null
  pendingChatId: string | null
  optimisticUserPrompts: OptimisticUserPrompt[]
  focusEpoch: number

  setSidebarData: (value: SidebarData) => void
  setOptimisticSidebarProjectOrder: (value: string[] | null | ((current: string[] | null) => string[] | null)) => void
  setLocalProjects: (value: LocalProjectsSnapshot | null) => void
  setUpdateSnapshot: (value: UpdateSnapshot | null) => void
  setUiRestartPhase: (value: string | null) => void
  setDiffSnapshotsByKey: (value: Record<string, ChatDiffSnapshot | null> | ((current: Record<string, ChatDiffSnapshot | null>) => Record<string, ChatDiffSnapshot | null>)) => void
  setKeybindings: (value: KeybindingsSnapshot | null) => void
  setPushConfig: (value: PushConfigSnapshot | null) => void
  setLlmProvider: (value: LlmProviderSnapshot | null) => void
  setConnectionStatus: (value: SocketStatus) => void
  setSidebarReady: (value: boolean) => void
  setLocalProjectsReady: (value: boolean) => void
  setSelectedProjectId: (value: string | null) => void
  setSidebarOpen: (value: boolean) => void
  setSidebarCollapsed: (value: boolean) => void
  setAddProjectModalOpen: (value: boolean) => void
  setCommandError: (value: string | null) => void
  setStartingLocalPath: (value: string | null) => void
  setPendingChatId: (value: string | null) => void
  setOptimisticUserPrompts: (value: OptimisticUserPrompt[] | ((current: OptimisticUserPrompt[]) => OptimisticUserPrompt[])) => void
  incrementFocusEpoch: () => void
}

export interface KannaStateStorePorts {
  storage?: StoragePort
}

// Read initial UI restart phase from sessionStorage synchronously at module load.
// This mirrors the original useState lazy-init pattern.
function readInitialUiRestartPhase(ports: KannaStateStorePorts = {}): string | null {
  const storage = ports.storage ?? sessionStorageAdapter
  return storage.getItem("kanna:ui-update-restart")
}

export const useKannaStateStore = create<KannaStateStoreState>()((set) => ({
  sidebarData: EMPTY_SIDEBAR_DATA,
  optimisticSidebarProjectOrder: null,
  localProjects: null,
  updateSnapshot: null,
  uiRestartPhase: readInitialUiRestartPhase(),
  diffSnapshotsByKey: EMPTY_DIFF_SNAPSHOTS,
  keybindings: null,
  pushConfig: null,
  llmProvider: null,
  connectionStatus: "connecting",
  sidebarReady: false,
  localProjectsReady: false,
  selectedProjectId: null,
  sidebarOpen: false,
  sidebarCollapsed: false,
  addProjectModalOpen: false,
  commandError: null,
  startingLocalPath: null,
  pendingChatId: null,
  optimisticUserPrompts: EMPTY_OPTIMISTIC_PROMPTS,
  focusEpoch: 0,

  setSidebarData: (value) => set({ sidebarData: value }),
  setOptimisticSidebarProjectOrder: (value) =>
    set((state) => ({
      optimisticSidebarProjectOrder: typeof value === "function" ? value(state.optimisticSidebarProjectOrder) : value,
    })),
  setLocalProjects: (value) => set({ localProjects: value }),
  setUpdateSnapshot: (value) => set({ updateSnapshot: value }),
  setUiRestartPhase: (value) => set({ uiRestartPhase: value }),
  setDiffSnapshotsByKey: (value) =>
    set((state) => ({
      diffSnapshotsByKey: typeof value === "function" ? value(state.diffSnapshotsByKey) : value,
    })),
  setKeybindings: (value) => set({ keybindings: value }),
  setPushConfig: (value) => set({ pushConfig: value }),
  setLlmProvider: (value) => set({ llmProvider: value }),
  setConnectionStatus: (value) => set({ connectionStatus: value }),
  setSidebarReady: (value) => set({ sidebarReady: value }),
  setLocalProjectsReady: (value) => set({ localProjectsReady: value }),
  setSelectedProjectId: (value) => set({ selectedProjectId: value }),
  setSidebarOpen: (value) => set({ sidebarOpen: value }),
  setSidebarCollapsed: (value) => set({ sidebarCollapsed: value }),
  setAddProjectModalOpen: (value) => set({ addProjectModalOpen: value }),
  setCommandError: (value) => set({ commandError: value }),
  setStartingLocalPath: (value) => set({ startingLocalPath: value }),
  setPendingChatId: (value) => set({ pendingChatId: value }),
  setOptimisticUserPrompts: (value) =>
    set((state) => ({
      optimisticUserPrompts: typeof value === "function" ? value(state.optimisticUserPrompts) : value,
    })),
  incrementFocusEpoch: () => set((state) => ({ focusEpoch: state.focusEpoch + 1 })),
}))
