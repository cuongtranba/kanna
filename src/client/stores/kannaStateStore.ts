import { create } from "zustand"
import type { AppSettingsSnapshot, ChatDiffSnapshot, KeybindingsSnapshot, LlmProviderSnapshot, PushConfigSnapshot, TranscriptEntry, UpdateSnapshot } from "../../shared/types"
import type { ChatSnapshot, LocalProjectsSnapshot, SidebarData } from "../../shared/types"
import { applyChatOps } from "../../shared/chat-ops"
import type { ChatOpsEvent } from "../../shared/chat-ops"
import type { SocketStatus } from "../app/socket"
import type { OptimisticUserPrompt } from "../app/useKannaState"

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
  /** Bumped when a chat.ops gap forces a resubscribe (fresh snapshot). */
  chatResyncNonce: number

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
  /**
   * Folds a `chat.ops` delta into the active snapshot.
   * "applied" on contiguous events; "stale" when already covered or for a
   * different chat; "gap" when the event skips ahead or the baseline has no
   * seq — caller must resync via bumpChatResyncNonce().
   */
  applyChatOpsEvent: (activeChatId: string, event: ChatOpsEvent) => "applied" | "stale" | "gap"
  bumpChatResyncNonce: () => void
}

// Read initial UI restart phase from sessionStorage synchronously at module load.
// This mirrors the original useState lazy-init pattern.
function readInitialUiRestartPhase(): string | null {
  if (typeof window === "undefined") return null
  return window.sessionStorage.getItem("kanna:ui-update-restart")
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
  chatResyncNonce: 0,

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
  applyChatOpsEvent: (activeChatId, event) => {
    let result: "applied" | "stale" | "gap" = "stale"
    set((state) => {
      const current = state.chatSnapshot
      if (!current || event.chatId !== activeChatId || current.runtime.chatId !== event.chatId) {
        result = "stale"
        return {}
      }
      if (current.seq === undefined) {
        result = "gap"
        return {}
      }
      if (event.toSeq <= current.seq) {
        result = "stale"
        return {}
      }
      if (event.fromSeq > current.seq + 1) {
        result = "gap"
        return {}
      }
      result = "applied"
      return { chatSnapshot: applyChatOps(current, event.ops, event.toSeq) }
    })
    return result
  },
  bumpChatResyncNonce: () => set((state) => ({ chatResyncNonce: state.chatResyncNonce + 1 })),
}))
