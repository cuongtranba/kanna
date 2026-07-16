import { create } from "zustand"
import type { AppSettingsSnapshot, ChatDiffSnapshot, KeybindingsSnapshot, LlmProviderSnapshot, PushConfigSnapshot, TranscriptEntry, UpdateSnapshot } from "../../shared/types"
import type { ChatSnapshot, LocalProjectsSnapshot, SidebarData } from "../../shared/types"
import { sessionStorageAdapter } from "../adapters/storage.adapter"
import type { SocketStatus } from "../app/socket"
import type { OptimisticUserPrompt } from "../app/useKannaState"
import type { StoragePort } from "../ports/storagePort"

interface OptimisticProcessingState {
  scopeId: string
  ackedAt: number | null
}

// Stable empty refs — NEVER use inline ?? [] or ?? {} in selectors (React error #185)
export const EMPTY_OPTIMISTIC_PROMPTS: OptimisticUserPrompt[] = []
export const EMPTY_OLDER_HISTORY: TranscriptEntry[] = []
export const EMPTY_PROJECT_DIFF_SNAPSHOTS: Record<string, ChatDiffSnapshot | null> = {}
export const EMPTY_SIDEBAR_DATA: SidebarData = { starredProjectGroups: [], projectGroups: [], stacks: [] }

interface KannaStateStoreState {
  sidebarData: SidebarData
  optimisticSidebarProjectOrder: string[] | null
  localProjects: LocalProjectsSnapshot | null
  updateSnapshot: UpdateSnapshot | null
  uiRestartPhase: string | null
  chatSnapshot: ChatSnapshot | null
  olderHistoryEntries: TranscriptEntry[]
  isHistoryLoading: boolean
  historyCursor: string | null
  hasOlderHistory: boolean
  projectDiffSnapshots: Record<string, ChatDiffSnapshot | null>
  keybindings: KeybindingsSnapshot | null
  appSettings: AppSettingsSnapshot | null
  pushConfig: PushConfigSnapshot | null
  llmProvider: LlmProviderSnapshot | null
  connectionStatus: SocketStatus
  sidebarReady: boolean
  localProjectsReady: boolean
  chatReady: boolean
  selectedProjectId: string | null
  sidebarOpen: boolean
  sidebarCollapsed: boolean
  addProjectModalOpen: boolean
  commandError: string | null
  startingLocalPath: string | null
  pendingChatId: string | null
  optimisticUserPrompts: OptimisticUserPrompt[]
  optimisticProcessing: OptimisticProcessingState | null
  focusEpoch: number

  setSidebarData: (value: SidebarData) => void
  setOptimisticSidebarProjectOrder: (value: string[] | null | ((current: string[] | null) => string[] | null)) => void
  setLocalProjects: (value: LocalProjectsSnapshot | null) => void
  setUpdateSnapshot: (value: UpdateSnapshot | null) => void
  setUiRestartPhase: (value: string | null) => void
  setChatSnapshot: (value: ChatSnapshot | null | ((current: ChatSnapshot | null) => ChatSnapshot | null)) => void
  setOlderHistoryEntries: (value: TranscriptEntry[] | ((current: TranscriptEntry[]) => TranscriptEntry[])) => void
  setIsHistoryLoading: (value: boolean) => void
  setHistoryCursor: (value: string | null) => void
  setHasOlderHistory: (value: boolean) => void
  setProjectDiffSnapshots: (value: Record<string, ChatDiffSnapshot | null> | ((current: Record<string, ChatDiffSnapshot | null>) => Record<string, ChatDiffSnapshot | null>)) => void
  setKeybindings: (value: KeybindingsSnapshot | null) => void
  setAppSettings: (value: AppSettingsSnapshot | null) => void
  setPushConfig: (value: PushConfigSnapshot | null) => void
  setLlmProvider: (value: LlmProviderSnapshot | null) => void
  setConnectionStatus: (value: SocketStatus) => void
  setSidebarReady: (value: boolean) => void
  setLocalProjectsReady: (value: boolean) => void
  setChatReady: (value: boolean) => void
  setSelectedProjectId: (value: string | null) => void
  setSidebarOpen: (value: boolean) => void
  setSidebarCollapsed: (value: boolean) => void
  setAddProjectModalOpen: (value: boolean) => void
  setCommandError: (value: string | null) => void
  setStartingLocalPath: (value: string | null) => void
  setPendingChatId: (value: string | null) => void
  setOptimisticUserPrompts: (value: OptimisticUserPrompt[] | ((current: OptimisticUserPrompt[]) => OptimisticUserPrompt[])) => void
  setOptimisticProcessing: (value: OptimisticProcessingState | null | ((current: OptimisticProcessingState | null) => OptimisticProcessingState | null)) => void
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
  chatSnapshot: null,
  olderHistoryEntries: EMPTY_OLDER_HISTORY,
  isHistoryLoading: false,
  historyCursor: null,
  hasOlderHistory: false,
  projectDiffSnapshots: EMPTY_PROJECT_DIFF_SNAPSHOTS,
  keybindings: null,
  appSettings: null,
  pushConfig: null,
  llmProvider: null,
  connectionStatus: "connecting",
  sidebarReady: false,
  localProjectsReady: false,
  chatReady: false,
  selectedProjectId: null,
  sidebarOpen: false,
  sidebarCollapsed: false,
  addProjectModalOpen: false,
  commandError: null,
  startingLocalPath: null,
  pendingChatId: null,
  optimisticUserPrompts: EMPTY_OPTIMISTIC_PROMPTS,
  optimisticProcessing: null,
  focusEpoch: 0,

  setSidebarData: (value) => set({ sidebarData: value }),
  setOptimisticSidebarProjectOrder: (value) =>
    set((state) => ({
      optimisticSidebarProjectOrder: typeof value === "function" ? value(state.optimisticSidebarProjectOrder) : value,
    })),
  setLocalProjects: (value) => set({ localProjects: value }),
  setUpdateSnapshot: (value) => set({ updateSnapshot: value }),
  setUiRestartPhase: (value) => set({ uiRestartPhase: value }),
  setChatSnapshot: (value) =>
    set((state) => ({
      chatSnapshot: typeof value === "function" ? value(state.chatSnapshot) : value,
    })),
  setOlderHistoryEntries: (value) =>
    set((state) => ({
      olderHistoryEntries: typeof value === "function" ? value(state.olderHistoryEntries) : value,
    })),
  setIsHistoryLoading: (value) => set({ isHistoryLoading: value }),
  setHistoryCursor: (value) => set({ historyCursor: value }),
  setHasOlderHistory: (value) => set({ hasOlderHistory: value }),
  setProjectDiffSnapshots: (value) =>
    set((state) => ({
      projectDiffSnapshots: typeof value === "function" ? value(state.projectDiffSnapshots) : value,
    })),
  setKeybindings: (value) => set({ keybindings: value }),
  setAppSettings: (value) => set({ appSettings: value }),
  setPushConfig: (value) => set({ pushConfig: value }),
  setLlmProvider: (value) => set({ llmProvider: value }),
  setConnectionStatus: (value) => set({ connectionStatus: value }),
  setSidebarReady: (value) => set({ sidebarReady: value }),
  setLocalProjectsReady: (value) => set({ localProjectsReady: value }),
  setChatReady: (value) => set({ chatReady: value }),
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
  setOptimisticProcessing: (value) =>
    set((state) => ({
      optimisticProcessing: typeof value === "function" ? value(state.optimisticProcessing) : value,
    })),
  incrementFocusEpoch: () => set((state) => ({ focusEpoch: state.focusEpoch + 1 })),
}))
