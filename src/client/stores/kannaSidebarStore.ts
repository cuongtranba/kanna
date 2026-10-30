import { create } from "zustand"
import type { GitWorktree, SidebarProjectGroup } from "../../shared/types"
import { clampRounded } from "../../shared/numeric"
import { localStorageAdapter } from "../adapters/storage.adapter"
import type { StoragePort } from "../ports/storagePort"

const SIDEBAR_WIDTH_STORAGE_KEY = "kanna:sidebar-width"
export const DEFAULT_SIDEBAR_WIDTH = 275
export const MIN_SIDEBAR_WIDTH = 220
export const MAX_SIDEBAR_WIDTH = 520

export interface KannaSidebarStorePorts {
  storage?: StoragePort
}

export const SIDEBAR_CONTENT_MIN_WIDTH = 400
export const SIDEBAR_CONTENT_MIN_WIDTH_SETTINGS = 720

const SIDEBAR_WIDTH_RANGE = { min: MIN_SIDEBAR_WIDTH, max: MAX_SIDEBAR_WIDTH }

export function clampSidebarWidth(width: number) {
  return clampRounded(width, SIDEBAR_WIDTH_RANGE, DEFAULT_SIDEBAR_WIDTH)
}

export interface ResolveSidebarWidthArgs {
  requestedWidth: number
  viewportWidth: number
  contentMinWidth?: number
}

export function resolveSidebarWidth({
  requestedWidth,
  viewportWidth,
  contentMinWidth = SIDEBAR_CONTENT_MIN_WIDTH,
}: ResolveSidebarWidthArgs) {
  const requested = clampSidebarWidth(requestedWidth)
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return requested

  const affordable = Math.min(MAX_SIDEBAR_WIDTH, viewportWidth - contentMinWidth)
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(affordable, requested))
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

function toggleInSet(previous: Set<string>, key: string): Set<string> {
  const next = new Set(previous)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

function withKey(previous: Set<string>, key: string): Set<string> {
  return previous.has(key) ? previous : new Set(previous).add(key)
}

function withoutKey(previous: Set<string>, key: string): Set<string> {
  if (!previous.has(key)) return previous
  const next = new Set(previous)
  next.delete(key)
  return next
}

function sameKeys(a: Set<string>, b: Set<string>) {
  return a.size === b.size && [...a].every((key) => b.has(key))
}

export interface SidebarGroupDescriptor {
  groupKey: string
  defaultCollapsed?: boolean
}

interface KannaSidebarState {
  collapsedSections: Set<string>
  expandedGroups: Set<string>
  expandedGroupsSnapshot: Set<string>
  initializedCollapsedGroupKeys: Set<string>
  revealedChatId: string | null
  nowMs: number
  showNumberJumpHints: boolean
  sidebarWidth: number
  isResizingSidebar: boolean
  archivedProjectId: string | null
  expandedStackIds: Set<string>
  stackCreatePanelOpen: boolean
  stackEditId: string | null
  stackDeleteConfirmId: string | null
  instructionsProjectId: string | null
  stackChatCreateId: string | null
  stackChatWorktrees: Map<string, GitWorktree[]>
  stackChatLoading: boolean
  isImporting: boolean
  importDialogOpen: boolean

  reconcileSidebarGroups: (groups: SidebarGroupDescriptor[]) => void
  toggleSectionCollapsed: (key: string) => void
  toggleGroupExpanded: (key: string) => void
  toggleAllSectionsCollapsed: (allGroupKeys: string[]) => void
  revealSidebarChat: (chatId: string, groups: SidebarProjectGroup[]) => void

  setSidebarWidth: (width: number) => void
  nudgeSidebarWidth: (delta: number) => void
  setSidebarWidthAndPersist: (width: number) => void
  commitSidebarWidth: () => void
  setIsResizingSidebar: (resizing: boolean) => void

  toggleStackExpanded: (stackId: string) => void
  openStackCreatePanel: () => void
  openStackEditPanel: (stackId: string) => void
  closeStackPanel: () => void
  setStackDeleteConfirmId: (id: string | null) => void
  setInstructionsProjectId: (projectId: string | null) => void

  beginStackChatCreate: (stackId: string) => void
  finishStackChatCreate: (worktrees: Map<string, GitWorktree[]>) => void
  endStackChatCreateLoading: () => void
  closeStackChatCreate: () => void

  setNowMs: (nowMs: number) => void
  setShowNumberJumpHints: (show: boolean) => void
  setArchivedProjectId: (id: string | null) => void
  setIsImporting: (importing: boolean) => void
  setImportDialogOpen: (open: boolean) => void
}

export const useKannaSidebarStore = create<KannaSidebarState>()((set) => ({
  collapsedSections: new Set<string>(),
  expandedGroups: new Set<string>(),
  expandedGroupsSnapshot: new Set<string>(),
  initializedCollapsedGroupKeys: new Set<string>(),
  revealedChatId: null,
  nowMs: Date.now(),
  showNumberJumpHints: false,
  sidebarWidth: readStoredSidebarWidth(),
  isResizingSidebar: false,
  archivedProjectId: null,
  expandedStackIds: new Set<string>(),
  stackCreatePanelOpen: false,
  stackEditId: null,
  stackDeleteConfirmId: null,
  instructionsProjectId: null,
  stackChatCreateId: null,
  stackChatWorktrees: EMPTY_STACK_CHAT_WORKTREES,
  stackChatLoading: false,
  isImporting: false,
  importDialogOpen: false,

  reconcileSidebarGroups: (groups) =>
    set((state) => {
      const projectKeys = new Set(groups.map((group) => group.groupKey))
      const nextInitialized = new Set(
        [...state.initializedCollapsedGroupKeys].filter((key) => projectKeys.has(key)),
      )

      const next = new Set<string>()
      for (const key of state.collapsedSections) {
        if (projectKeys.has(key)) next.add(key)
      }

      for (const group of groups) {
        if (nextInitialized.has(group.groupKey)) continue
        nextInitialized.add(group.groupKey)
        if (group.defaultCollapsed) next.add(group.groupKey)
      }

      return {
        initializedCollapsedGroupKeys: nextInitialized,
        collapsedSections: sameKeys(next, state.collapsedSections)
          ? state.collapsedSections
          : next,
      }
    }),

  toggleSectionCollapsed: (key) =>
    set((state) => ({ collapsedSections: toggleInSet(state.collapsedSections, key) })),

  toggleGroupExpanded: (key) =>
    set((state) => ({ expandedGroups: toggleInSet(state.expandedGroups, key) })),

  toggleAllSectionsCollapsed: (allGroupKeys) =>
    set((state) => {
      if (allGroupKeys.length === 0) return state

      const allCollapsed = allGroupKeys.every((key) => state.collapsedSections.has(key))
      if (allCollapsed) {
        return {
          collapsedSections: new Set<string>(),
          expandedGroups: state.expandedGroupsSnapshot,
        }
      }

      return {
        expandedGroupsSnapshot: state.expandedGroups,
        collapsedSections: new Set(allGroupKeys),
        expandedGroups: new Set<string>(),
      }
    }),

  revealSidebarChat: (chatId, groups) =>
    set((state) => {
      if (state.revealedChatId === chatId) return state

      for (const group of groups) {
        const chat = group.chats.find((row) => row.chatId === chatId)
        if (!chat) continue
        if (chat.stackId) {
          return { revealedChatId: chatId, expandedStackIds: withKey(state.expandedStackIds, chat.stackId) }
        }
        const inOlderChats = group.olderChats.some((row) => row.chatId === chatId)
        return {
          revealedChatId: chatId,
          collapsedSections: withoutKey(state.collapsedSections, group.groupKey),
          expandedGroups: inOlderChats ? withKey(state.expandedGroups, group.groupKey) : state.expandedGroups,
        }
      }

      return state
    }),

  setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),

  nudgeSidebarWidth: (delta) =>
    set((state) => {
      const sidebarWidth = clampSidebarWidth(state.sidebarWidth + delta)
      if (sidebarWidth === state.sidebarWidth) return state
      persistSidebarWidth(sidebarWidth)
      return { sidebarWidth }
    }),

  setSidebarWidthAndPersist: (width) => {
    const clamped = clampSidebarWidth(width)
    persistSidebarWidth(clamped)
    set({ sidebarWidth: clamped })
  },

  commitSidebarWidth: () =>
    set((state) => {
      const sidebarWidth = clampSidebarWidth(state.sidebarWidth)
      persistSidebarWidth(sidebarWidth)
      return sidebarWidth === state.sidebarWidth ? state : { sidebarWidth }
    }),

  setIsResizingSidebar: (resizing) => set({ isResizingSidebar: resizing }),

  toggleStackExpanded: (stackId) =>
    set((state) => ({ expandedStackIds: toggleInSet(state.expandedStackIds, stackId) })),

  openStackCreatePanel: () => set({ stackCreatePanelOpen: true, stackEditId: null }),

  openStackEditPanel: (stackId) => set({ stackCreatePanelOpen: true, stackEditId: stackId }),

  closeStackPanel: () =>
    set((state) =>
      state.stackCreatePanelOpen || state.stackEditId !== null
        ? { stackCreatePanelOpen: false, stackEditId: null }
        : state,
    ),

  setStackDeleteConfirmId: (id) => set({ stackDeleteConfirmId: id }),

  setInstructionsProjectId: (projectId) => set({ instructionsProjectId: projectId }),

  beginStackChatCreate: (stackId) =>
    set({ stackChatCreateId: stackId, stackChatLoading: true }),

  finishStackChatCreate: (worktrees) =>
    set({ stackChatWorktrees: worktrees, stackChatLoading: false }),

  endStackChatCreateLoading: () => set({ stackChatLoading: false }),

  closeStackChatCreate: () =>
    set({ stackChatCreateId: null, stackChatWorktrees: EMPTY_STACK_CHAT_WORKTREES }),

  setNowMs: (nowMs) => set({ nowMs }),

  setShowNumberJumpHints: (show) => set({ showNumberJumpHints: show }),

  setArchivedProjectId: (id) => set({ archivedProjectId: id }),

  setIsImporting: (importing) => set({ isImporting: importing }),

  setImportDialogOpen: (open) => set({ importDialogOpen: open }),
}))

export { persistSidebarWidth, readStoredSidebarWidth }
