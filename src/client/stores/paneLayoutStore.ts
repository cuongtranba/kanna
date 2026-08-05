import { create } from "zustand"
import { persist } from "zustand/middleware"
import {
  closeTab as closeTabInLayout,
  createDefaultLayout,
  focusPane as focusPaneInLayout,
  focusTab as focusTabInLayout,
  moveTabToPane as moveTabInLayout,
  normalizeLayout,
  openTab as openTabInLayout,
  reorderPaneTabs as reorderPaneTabsInLayout,
  resizeGroup as resizeGroupInLayout,
  splitPane as splitPaneInLayout,
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
  reorderPaneTabs: (projectId: string, paneId: string, orderedTabIds: readonly string[]) => void
  resizeGroup: (projectId: string, groupId: string, index: number, deltaRatio: number) => void
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

        reorderPaneTabs: (projectId, paneId, orderedTabIds) =>
          apply(projectId, (layout) => reorderPaneTabsInLayout(layout, paneId, orderedTabIds)),

        resizeGroup: (projectId, groupId, index, deltaRatio) =>
          apply(projectId, (layout) => resizeGroupInLayout(layout, groupId, index, deltaRatio)),

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
