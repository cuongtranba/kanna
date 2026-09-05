import { create } from "zustand"
import { persist } from "zustand/middleware"
import {
  closeTab as closeTabInLayout,
  collectPanes,
  createDefaultLayout,
  findAdjacentPane,
  findResizeBoundary,
  focusPane as focusPaneInLayout,
  focusTab as focusTabInLayout,
  moveTabToPane as moveTabInLayout,
  normalizeLayout,
  openTab as openTabInLayout,
  reorderPaneTabs as reorderPaneTabsInLayout,
  resizeGroup as resizeGroupInLayout,
  setGroupSizes as setGroupSizesInLayout,
  splitPane as splitPaneInLayout,
  type PaneDirection,
  type PaneLayout,
  type PaneTabTarget,
  type SplitPosition,
} from "../lib/paneTree"
import { isRecord } from "../../shared/errors"
import { asJsonValue } from "../lib/asJsonValue"
import { buildLayoutFromLegacy, type LegacyProjectLayout } from "./paneLayoutMigration"


interface PaneLayoutState {
  layout: PaneLayout
  nodeSequence: number

  getLayout: () => PaneLayout
  openTab: (target: PaneTabTarget) => void
  closeTab: (tabId: string) => void
  focusTab: (tabId: string) => void
  focusPane: (paneId: string) => void
  splitPane: (args: { tabId: string; targetPaneId: string; position: SplitPosition }) => void
  moveTabToPane: (tabId: string, toPaneId: string, index?: number) => void
  focusAdjacentPane: (direction: PaneDirection) => void
  resizeFocusedPane: (direction: PaneDirection) => void
  cycleFocusedPaneTab: (delta: number) => void
  closeFocusedTab: () => void
  splitFocusedPane: (position: SplitPosition) => void
  reorderPaneTabs: (paneId: string, orderedTabIds: readonly string[]) => void
  resizeGroup: (groupId: string, index: number, deltaRatio: number) => void
  setGroupSizes: (groupId: string, sizes: readonly number[]) => void
  seedFromLegacy: (legacy: LegacyProjectLayout) => void
}

function hasAnyTab(layout: PaneLayout): boolean {
  return collectPanes(layout.root).some((pane) => pane.tabs.length > 0)
}

export const usePaneLayoutStore = create<PaneLayoutState>()(
  persist(
    (set, get) => {
      function apply(operation: (layout: PaneLayout) => PaneLayout | null): void {
        set((state) => {
          const next = operation(state.layout)
          if (!next) return state
          return { ...state, layout: next }
        })
      }

      function takeNodeIds() {
        const sequence = get().nodeSequence + 1
        set({ nodeSequence: sequence })
        return { paneId: `pane-${sequence}`, groupId: `group-${sequence}` }
      }

      return {
        layout: createDefaultLayout(),
        nodeSequence: 0,

        getLayout: () => get().layout,

        openTab: (target) =>
          apply((layout) => openTabInLayout(layout, target, { createdAt: 0 })?.layout ?? null),

        closeTab: (tabId) => apply((layout) => closeTabInLayout(layout, tabId)),

        focusTab: (tabId) => apply((layout) => focusTabInLayout(layout, tabId)),

        focusPane: (paneId) => apply((layout) => focusPaneInLayout(layout, paneId)),

        splitPane: (args) => {
          const ids = takeNodeIds()
          apply((layout) => splitPaneInLayout(layout, { ...args, ids }))
        },

        moveTabToPane: (tabId, toPaneId, index) =>
          apply((layout) => moveTabInLayout(layout, tabId, toPaneId, index)),


        focusAdjacentPane: (direction) =>
          apply((layout) => {
            if (!layout.focusedPaneId) return null
            const nextId = findAdjacentPane(layout.root, layout.focusedPaneId, direction)
            return nextId ? focusPaneInLayout(layout, nextId) : null
          }),

        resizeFocusedPane: (direction) =>
          apply((layout) => {
            if (!layout.focusedPaneId) return null
            const boundary = findResizeBoundary(layout.root, layout.focusedPaneId, direction)
            if (!boundary) return null
            return resizeGroupInLayout(layout, boundary.groupId, boundary.index, boundary.deltaRatio)
          }),

        cycleFocusedPaneTab: (delta) =>
          apply((layout) => {
            const pane = collectPanes(layout.root).find((p) => p.id === layout.focusedPaneId)
            if (!pane || pane.tabs.length === 0) return null

            const current = pane.tabs.findIndex((tab) => tab.tabId === pane.focusedTabId)
            const from = current === -1 ? 0 : current
            const next = (((from + delta) % pane.tabs.length) + pane.tabs.length) % pane.tabs.length
            return focusTabInLayout(layout, pane.tabs[next].tabId)
          }),

        closeFocusedTab: () =>
          apply((layout) => {
            const pane = collectPanes(layout.root).find((p) => p.id === layout.focusedPaneId)
            const tabId = pane?.focusedTabId ?? pane?.tabs[0]?.tabId
            return tabId ? closeTabInLayout(layout, tabId) : null
          }),

        splitFocusedPane: (position) => {
          const layout = get().layout
          const pane = collectPanes(layout.root).find((p) => p.id === layout.focusedPaneId)
          const tabId = pane?.focusedTabId ?? pane?.tabs[0]?.tabId
          if (!pane || !tabId) return

          const ids = takeNodeIds()
          apply((current) =>
            splitPaneInLayout(current, { tabId, targetPaneId: pane.id, position, ids }),
          )
        },

        reorderPaneTabs: (paneId, orderedTabIds) =>
          apply((layout) => reorderPaneTabsInLayout(layout, paneId, orderedTabIds)),

        resizeGroup: (groupId, index, deltaRatio) =>
          apply((layout) => resizeGroupInLayout(layout, groupId, index, deltaRatio)),

        setGroupSizes: (groupId, sizes) =>
          apply((layout) => setGroupSizesInLayout(layout, groupId, sizes)),

        seedFromLegacy: (legacy) =>
          set((state) => {
            if (hasAnyTab(state.layout)) return state
            return { ...state, layout: buildLayoutFromLegacy(legacy) }
          }),
      }
    },
    {
      name: "pane-layouts",
      version: 2,
      migrate: (persisted, version) => {
        if (version >= 2) return persisted
        const rawSequence = isRecord(persisted) ? persisted.nodeSequence : undefined
        return { nodeSequence: typeof rawSequence === "number" ? rawSequence : 0 }
      },
      merge: (persisted, current) => {
        if (!isRecord(persisted)) return current

        const normalized = normalizeLayout(asJsonValue(persisted.layout))
        const layout = hasAnyTab(normalized) ? normalized : current.layout

        const rawSequence = persisted.nodeSequence
        const nodeSequence =
          typeof rawSequence === "number" && Number.isFinite(rawSequence) ? rawSequence : 0

        return { ...current, layout, nodeSequence }
      },
      partialize: (state) => ({ layout: state.layout, nodeSequence: state.nodeSequence }),
    },
  ),
)
