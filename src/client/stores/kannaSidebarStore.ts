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

/** Narrowest the main content column may become before the sidebar yields. */
export const SIDEBAR_CONTENT_MIN_WIDTH = 400
/** Settings is a two-column split, so it needs more room than a chat transcript. */
export const SIDEBAR_CONTENT_MIN_WIDTH_SETTINGS = 720

export function clampSidebarWidth(width: number) {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)))
}

export interface ResolveSidebarWidthArgs {
  /** The width the user asked for (stored preference or live drag). */
  requestedWidth: number
  /** Measured window width; 0 when unmeasured. */
  viewportWidth: number
  contentMinWidth?: number
}

/**
 * Clamp the sidebar against the viewport as well as its own bounds.
 *
 * `clampSidebarWidth` alone only honours [MIN, MAX], so on a 900px window a
 * 520px sidebar left 380px of chat. Here the content column is served first:
 * the sidebar gets whatever is left over, but never drops below its own floor.
 *
 * An unmeasured viewport passes the request straight through — collapsing during
 * hydration would render a narrow sidebar that jumps wider on the first frame.
 */
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

/** Flip one key of a Set, always returning a new Set. */
function toggleInSet(previous: Set<string>, key: string): Set<string> {
  const next = new Set(previous)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

function sameKeys(a: Set<string>, b: Set<string>) {
  return a.size === b.size && [...a].every((key) => b.has(key))
}

/** One project group, as far as collapse reconciliation is concerned. */
export interface SidebarGroupDescriptor {
  groupKey: string
  defaultCollapsed?: boolean
}

interface KannaSidebarState {
  collapsedSections: Set<string>
  expandedGroups: Set<string>
  /** Expansion captured before a collapse-all, restored by the next expand-all. */
  expandedGroupsSnapshot: Set<string>
  /** Groups whose defaultCollapsed has already been applied once. */
  initializedCollapsedGroupKeys: Set<string>
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
  importDialogOpen: boolean

  // ─── Sections / groups ────────────────────────────────────────────────────
  /** Drop keys for vanished groups and apply defaultCollapsed to newly-seen ones. */
  reconcileSidebarGroups: (groups: SidebarGroupDescriptor[]) => void
  toggleSectionCollapsed: (key: string) => void
  toggleGroupExpanded: (key: string) => void
  /** Collapse everything, or restore the expansion captured by the last collapse-all. */
  toggleAllSectionsCollapsed: (allGroupKeys: string[]) => void

  // ─── Width ────────────────────────────────────────────────────────────────
  setSidebarWidth: (width: number) => void
  /** Step the width by a delta, clamped, and persist it. No-op at the boundary. */
  nudgeSidebarWidth: (delta: number) => void
  setSidebarWidthAndPersist: (width: number) => void
  /** Clamp the live drag width and write it through to storage. */
  commitSidebarWidth: () => void
  setIsResizingSidebar: (resizing: boolean) => void

  // ─── Stacks ───────────────────────────────────────────────────────────────
  toggleStackExpanded: (stackId: string) => void
  openStackCreatePanel: () => void
  openStackEditPanel: (stackId: string) => void
  closeStackPanel: () => void
  setStackDeleteConfirmId: (id: string | null) => void

  // ─── Stack chat creation ──────────────────────────────────────────────────
  beginStackChatCreate: (stackId: string) => void
  finishStackChatCreate: (worktrees: Map<string, GitWorktree[]>) => void
  endStackChatCreateLoading: () => void
  closeStackChatCreate: () => void

  // ─── Misc ─────────────────────────────────────────────────────────────────
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

// Re-export helpers that are used in KannaSidebar
export { persistSidebarWidth, readStoredSidebarWidth }
