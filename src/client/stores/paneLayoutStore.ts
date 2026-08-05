import { create } from "zustand"
import { persist } from "zustand/middleware"
import {
  closeTab as closeTabInLayout,
  collectPanes,
  createDefaultLayout,
  findAdjacentPane,
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
import { buildLayoutFromLegacy, type LegacyProjectLayout } from "./paneLayoutMigration"

/**
 * Per-project pane layout.
 *
 * The tree itself is pure (`lib/paneTree`); this store owns only the two things
 * the engine deliberately does not: which project a layout belongs to, and the
 * ids for newly created nodes. Every action funnels through `apply`, so a pure
 * operation returning null becomes an untouched state object rather than a
 * pointless re-render.
 */

interface PaneLayoutState {
  layouts: Record<string, PaneLayout>
  /** Monotonic source of unique node ids. Persisted so ids never collide across reloads. */
  nodeSequence: number

  getLayout: (projectId: string) => PaneLayout
  openTab: (projectId: string, target: PaneTabTarget) => void
  closeTab: (projectId: string, tabId: string) => void
  focusTab: (projectId: string, tabId: string) => void
  focusPane: (projectId: string, paneId: string) => void
  splitPane: (
    projectId: string,
    args: { tabId: string; targetPaneId: string; position: SplitPosition },
  ) => void
  moveTabToPane: (projectId: string, tabId: string, toPaneId: string, index?: number) => void
  /** Keyboard: move focus to the nearest pane in a direction. */
  focusAdjacentPane: (projectId: string, direction: PaneDirection) => void
  /** Keyboard: step the focused pane's active tab, wrapping at both ends. */
  cycleFocusedPaneTab: (projectId: string, delta: number) => void
  /** Keyboard: close the focused pane's active tab. */
  closeFocusedTab: (projectId: string) => void
  /** Keyboard: split around the focused pane's active tab. */
  splitFocusedPane: (projectId: string, position: SplitPosition) => void
  reorderPaneTabs: (projectId: string, paneId: string, orderedTabIds: readonly string[]) => void
  resizeGroup: (projectId: string, groupId: string, index: number, deltaRatio: number) => void
  /** Commit a finished drag: absolute fractions, in child order. */
  setGroupSizes: (projectId: string, groupId: string, sizes: readonly number[]) => void
  /** Install a layout derived from the pre-tabs stores, unless one already exists. */
  seedFromLegacy: (projectId: string, legacy: LegacyProjectLayout) => void
  clearProject: (projectId: string) => void
}

function layoutFor(layouts: Record<string, PaneLayout>, projectId: string): PaneLayout {
  return layouts[projectId] ?? createDefaultLayout()
}

export const usePaneLayoutStore = create<PaneLayoutState>()(
  persist(
    (set, get) => {
      /**
       * Run a pure operation against one project's layout. A null result means
       * "nothing changed", and the state object is returned untouched so
       * zustand skips notifying subscribers.
       */
      function apply(
        projectId: string,
        operation: (layout: PaneLayout) => PaneLayout | null,
      ): void {
        set((state) => {
          const next = operation(layoutFor(state.layouts, projectId))
          if (!next) return state
          return { ...state, layouts: { ...state.layouts, [projectId]: next } }
        })
      }

      /** Unique ids for the nodes an operation may create. */
      function takeNodeIds() {
        const sequence = get().nodeSequence + 1
        set({ nodeSequence: sequence })
        return { paneId: `pane-${sequence}`, groupId: `group-${sequence}` }
      }

      return {
        layouts: {},
        nodeSequence: 0,

        getLayout: (projectId) => layoutFor(get().layouts, projectId),

        openTab: (projectId, target) =>
          apply(projectId, (layout) => openTabInLayout(layout, target, { createdAt: 0 })?.layout ?? null),

        closeTab: (projectId, tabId) =>
          apply(projectId, (layout) => closeTabInLayout(layout, tabId)),

        focusTab: (projectId, tabId) =>
          apply(projectId, (layout) => focusTabInLayout(layout, tabId)),

        focusPane: (projectId, paneId) =>
          apply(projectId, (layout) => focusPaneInLayout(layout, paneId)),

        splitPane: (projectId, args) => {
          const ids = takeNodeIds()
          apply(projectId, (layout) => splitPaneInLayout(layout, { ...args, ids }))
        },

        moveTabToPane: (projectId, tabId, toPaneId, index) =>
          apply(projectId, (layout) => moveTabInLayout(layout, tabId, toPaneId, index)),

        // ─── Keyboard commands ────────────────────────────────────────────────
        // Each derives its subject (the focused pane, its active tab) INSIDE the
        // store, so a caller only has to say what the user pressed.

        focusAdjacentPane: (projectId, direction) =>
          apply(projectId, (layout) => {
            if (!layout.focusedPaneId) return null
            const nextId = findAdjacentPane(layout.root, layout.focusedPaneId, direction)
            return nextId ? focusPaneInLayout(layout, nextId) : null
          }),

        cycleFocusedPaneTab: (projectId, delta) =>
          apply(projectId, (layout) => {
            const pane = collectPanes(layout.root).find((p) => p.id === layout.focusedPaneId)
            if (!pane || pane.tabs.length === 0) return null

            const current = pane.tabs.findIndex((tab) => tab.tabId === pane.focusedTabId)
            const from = current === -1 ? 0 : current
            // Wrap in both directions; `%` alone goes negative for delta -1.
            const next = (((from + delta) % pane.tabs.length) + pane.tabs.length) % pane.tabs.length
            return focusTabInLayout(layout, pane.tabs[next].tabId)
          }),

        closeFocusedTab: (projectId) =>
          apply(projectId, (layout) => {
            const pane = collectPanes(layout.root).find((p) => p.id === layout.focusedPaneId)
            const tabId = pane?.focusedTabId ?? pane?.tabs[0]?.tabId
            return tabId ? closeTabInLayout(layout, tabId) : null
          }),

        splitFocusedPane: (projectId, position) => {
          const layout = layoutFor(get().layouts, projectId)
          const pane = collectPanes(layout.root).find((p) => p.id === layout.focusedPaneId)
          const tabId = pane?.focusedTabId ?? pane?.tabs[0]?.tabId
          if (!pane || !tabId) return

          const ids = takeNodeIds()
          apply(projectId, (current) =>
            splitPaneInLayout(current, { tabId, targetPaneId: pane.id, position, ids }),
          )
        },

        reorderPaneTabs: (projectId, paneId, orderedTabIds) =>
          apply(projectId, (layout) => reorderPaneTabsInLayout(layout, paneId, orderedTabIds)),

        resizeGroup: (projectId, groupId, index, deltaRatio) =>
          apply(projectId, (layout) => resizeGroupInLayout(layout, groupId, index, deltaRatio)),

        setGroupSizes: (projectId, groupId, sizes) =>
          apply(projectId, (layout) => setGroupSizesInLayout(layout, groupId, sizes)),

        seedFromLegacy: (projectId, legacy) =>
          set((state) => {
            if (state.layouts[projectId]) return state
            return {
              ...state,
              layouts: { ...state.layouts, [projectId]: buildLayoutFromLegacy(legacy) },
            }
          }),

        clearProject: (projectId) =>
          set((state) => {
            if (!state.layouts[projectId]) return state
            const { [projectId]: _removed, ...rest } = state.layouts
            return { ...state, layouts: rest }
          }),
      }
    },
    {
      name: "pane-layouts",
      version: 1,
      /**
       * Every persisted layout is rebuilt through `normalizeLayout` on read, so
       * a tree written by an older release — or hand-edited — is repaired rather
       * than trusted. This is why the tree needs no structural migrations.
       */
      merge: (persisted, current) => {
        if (typeof persisted !== "object" || persisted === null) return current

        const rawLayouts = Reflect.get(persisted, "layouts")
        const layouts: Record<string, PaneLayout> = {}
        if (typeof rawLayouts === "object" && rawLayouts !== null) {
          for (const [projectId, layout] of Object.entries(rawLayouts)) {
            layouts[projectId] = normalizeLayout(layout)
          }
        }

        const rawSequence = Reflect.get(persisted, "nodeSequence")
        const nodeSequence =
          typeof rawSequence === "number" && Number.isFinite(rawSequence) ? rawSequence : 0

        return { ...current, layouts, nodeSequence }
      },
      partialize: (state) => ({ layouts: state.layouts, nodeSequence: state.nodeSequence }),
    },
  ),
)
