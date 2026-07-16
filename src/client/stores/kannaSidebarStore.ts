import { create } from "zustand"
import type { GitWorktree } from "../../shared/types"
import { localStorageAdapter } from "../adapters/storage.adapter"
import type { StoragePort } from "../ports/storagePort"

const SIDEBAR_WIDTH_STORAGE_KEY = "kanna:sidebar-width"
export const DEFAULT_SIDEBAR_WIDTH = 275
export const MIN_SIDEBAR_WIDTH = 220
export const MAX_SIDEBAR_WIDTH = 520

export interface KannaSidebarStorePorts {
  storage?: StoragePort
}

export function clampSidebarWidth(width: number) {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)))
}

function readStoredSidebarWidth(ports: KannaSidebarStorePorts = {}) {
  const storage = ports.storage ?? localStorageAdapter
  const stored = storage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
  return stored ? clampSidebarWidth(Number(stored)) : DEFAULT_SIDEBAR_WIDTH
}

function persistSidebarWidth(width: number, ports: KannaSidebarStorePorts = {}) {
  const storage = ports.storage ?? localStorageAdapter
  storage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(width)))
}

const EMPTY_STACK_CHAT_WORKTREES = new Map<string, GitWorktree[]>()

interface KannaSidebarState {
  collapsedSections: Set<string>
  expandedGroups: Set<string>
  nowMs: number
  showNumberJumpHints: boolean
  sidebarWidth: number
  isResizingSidebar: boolean
  archivedProjectId: string | null
  expandedStackIds: Set<string>
  stackCreatePanelOpen: boolean
  stackEditId: string | null
  stackDeleteConfirmId: string | null
  stackChatCreateId: string | null
  stackChatWorktrees: Map<string, GitWorktree[]>
  stackChatLoading: boolean
  isImporting: boolean

  // Actions
  setCollapsedSections: (updater: (previous: Set<string>) => Set<string>) => void
  setExpandedGroups: (updater: (previous: Set<string>) => Set<string>) => void
  setExpandedGroupsSnapshot: (groups: Set<string>) => void
  setNowMs: (nowMs: number) => void
  setShowNumberJumpHints: (show: boolean) => void
  setSidebarWidth: (updater: number | ((current: number) => number)) => void
  setSidebarWidthAndPersist: (width: number) => void
  setIsResizingSidebar: (resizing: boolean) => void
  setArchivedProjectId: (id: string | null) => void
  setExpandedStackIds: (updater: (previous: Set<string>) => Set<string>) => void
  setStackCreatePanelOpen: (open: boolean) => void
  setStackEditId: (id: string | null) => void
  setStackDeleteConfirmId: (id: string | null) => void
  setStackChatCreateId: (id: string | null) => void
  setStackChatWorktrees: (worktrees: Map<string, GitWorktree[]>) => void
  setStackChatLoading: (loading: boolean) => void
  setIsImporting: (importing: boolean) => void
}

export const useKannaSidebarStore = create<KannaSidebarState>()((set) => ({
  collapsedSections: new Set<string>(),
  expandedGroups: new Set<string>(),
  nowMs: Date.now(),
  showNumberJumpHints: false,
  sidebarWidth: readStoredSidebarWidth(),
  isResizingSidebar: false,
  archivedProjectId: null,
  expandedStackIds: new Set<string>(),
  stackCreatePanelOpen: false,
  stackEditId: null,
  stackDeleteConfirmId: null,
  stackChatCreateId: null,
  stackChatWorktrees: EMPTY_STACK_CHAT_WORKTREES,
  stackChatLoading: false,
  isImporting: false,

  setCollapsedSections: (updater) =>
    set((state) => ({ collapsedSections: updater(state.collapsedSections) })),

  setExpandedGroups: (updater) =>
    set((state) => ({ expandedGroups: updater(state.expandedGroups) })),

  setExpandedGroupsSnapshot: (groups) =>
    set({ expandedGroups: groups }),

  setNowMs: (nowMs) => set({ nowMs }),

  setShowNumberJumpHints: (show) => set({ showNumberJumpHints: show }),

  setSidebarWidth: (updater) => {
    if (typeof updater === "function") {
      set((state) => ({ sidebarWidth: updater(state.sidebarWidth) }))
    } else {
      set({ sidebarWidth: updater })
    }
  },

  setSidebarWidthAndPersist: (width) => {
    const clamped = clampSidebarWidth(width)
    persistSidebarWidth(clamped)
    set({ sidebarWidth: clamped })
  },

  setIsResizingSidebar: (resizing) => set({ isResizingSidebar: resizing }),

  setArchivedProjectId: (id) => set({ archivedProjectId: id }),

  setExpandedStackIds: (updater) =>
    set((state) => ({ expandedStackIds: updater(state.expandedStackIds) })),

  setStackCreatePanelOpen: (open) => set({ stackCreatePanelOpen: open }),

  setStackEditId: (id) => set({ stackEditId: id }),

  setStackDeleteConfirmId: (id) => set({ stackDeleteConfirmId: id }),

  setStackChatCreateId: (id) => set({ stackChatCreateId: id }),

  setStackChatWorktrees: (worktrees) => set({ stackChatWorktrees: worktrees }),

  setStackChatLoading: (loading) => set({ stackChatLoading: loading }),

  setIsImporting: (importing) => set({ isImporting: importing }),
}))

// Re-export helpers that are used in KannaSidebar
export { persistSidebarWidth, readStoredSidebarWidth }
