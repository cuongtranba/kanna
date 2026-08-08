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
import { isRecord } from "../../shared/errors"
import { buildLayoutFromLegacy, type LegacyProjectLayout } from "./paneLayoutMigration"

/**
 * The workspace pane layout — ONE tree for the whole app.
 *
 * It used to be one tree per project, which meant the workspace you saw was
 * whichever project the selected chat happened to belong to: opening a chat in
 * project B swapped the whole arrangement out, and chats from two projects
 * could never sit side by side. Since a chat tab addresses its own chatId and
 * renders its own live transcript, there is nothing project-shaped left about
 * the arrangement itself — so the project axis is gone rather than re-keyed.
 * What a tab needs from a project it resolves at render time from that tab's
 * own target (see ChatPage's terminal renderer).
 *
 * The tree itself is pure (`lib/paneTree`); this store owns only what the
 * engine deliberately does not: the ids for newly created nodes. Every action
 * funnels through `apply`, so a pure operation returning null becomes an
 * untouched state object rather than a pointless re-render.
 */

interface PaneLayoutState {
  layout: PaneLayout
  /** Monotonic source of unique node ids. Persisted so ids never collide across reloads. */
  nodeSequence: number

  /** Read the current tree without subscribing — for effects and callbacks. */
  getLayout: () => PaneLayout
  openTab: (target: PaneTabTarget) => void
  closeTab: (tabId: string) => void
  focusTab: (tabId: string) => void
  focusPane: (paneId: string) => void
  splitPane: (args: { tabId: string; targetPaneId: string; position: SplitPosition }) => void
  moveTabToPane: (tabId: string, toPaneId: string, index?: number) => void
  /** Keyboard: move focus to the nearest pane in a direction. */
  focusAdjacentPane: (direction: PaneDirection) => void
  /** Keyboard: step the focused pane's active tab, wrapping at both ends. */
  cycleFocusedPaneTab: (delta: number) => void
  /** Keyboard: close the focused pane's active tab. */
  closeFocusedTab: () => void
  /** Keyboard: split around the focused pane's active tab. */
  splitFocusedPane: (position: SplitPosition) => void
  reorderPaneTabs: (paneId: string, orderedTabIds: readonly string[]) => void
  resizeGroup: (groupId: string, index: number, deltaRatio: number) => void
  /** Commit a finished drag: absolute fractions, in child order. */
  setGroupSizes: (groupId: string, sizes: readonly number[]) => void
  /** Install a layout derived from the pre-tabs stores, unless one already exists. */
  seedFromLegacy: (legacy: LegacyProjectLayout) => void
}

function hasAnyTab(layout: PaneLayout): boolean {
  return collectPanes(layout.root).some((pane) => pane.tabs.length > 0)
}

export const usePaneLayoutStore = create<PaneLayoutState>()(
  persist(
    (set, get) => {
      /**
       * Run a pure operation against the layout. A null result means "nothing
       * changed", and the state object is returned untouched so zustand skips
       * notifying subscribers.
       */
      function apply(operation: (layout: PaneLayout) => PaneLayout | null): void {
        set((state) => {
          const next = operation(state.layout)
          if (!next) return state
          return { ...state, layout: next }
        })
      }

      /** Unique ids for the nodes an operation may create. */
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

        // ─── Keyboard commands ────────────────────────────────────────────────
        // Each derives its subject (the focused pane, its active tab) INSIDE the
        // store, so a caller only has to say what the user pressed.

        focusAdjacentPane: (direction) =>
          apply((layout) => {
            if (!layout.focusedPaneId) return null
            const nextId = findAdjacentPane(layout.root, layout.focusedPaneId, direction)
            return nextId ? focusPaneInLayout(layout, nextId) : null
          }),

        cycleFocusedPaneTab: (delta) =>
          apply((layout) => {
            const pane = collectPanes(layout.root).find((p) => p.id === layout.focusedPaneId)
            if (!pane || pane.tabs.length === 0) return null

            const current = pane.tabs.findIndex((tab) => tab.tabId === pane.focusedTabId)
            const from = current === -1 ? 0 : current
            // Wrap in both directions; `%` alone goes negative for delta -1.
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

        // Seeds the ONE workspace, so it fires for whichever project the user
        // opens first and is a no-op forever after — the arrangement is no
        // longer per project, and re-seeding from a second project would blow
        // away tabs the user has since arranged.
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
      /**
       * v1 persisted one tree PER PROJECT under `layouts`. There is no honest
       * mapping from N project trees to the single workspace tree, so the
       * arrangement is dropped rather than guessed at: ChatPage's reconcile
       * effect re-opens a tab for the chat in the URL, for the active project's
       * terminals, and for the changes panel when it is showing, so the only
       * thing actually lost is hand-made splits and sizes — once.
       *
       * `nodeSequence` is carried over so ids minted after the migration cannot
       * collide with ids still referenced by per-pane state.
       */
      migrate: (persisted, version) => {
        if (version >= 2) return persisted
        const rawSequence = isRecord(persisted) ? persisted.nodeSequence : undefined
        return { nodeSequence: typeof rawSequence === "number" ? rawSequence : 0 }
      },
      /**
       * The persisted layout is rebuilt through `normalizeLayout` on read, so a
       * tree written by an older release — or hand-edited — is repaired rather
       * than trusted. This is why the tree needs no structural migrations.
       */
      merge: (persisted, current) => {
        if (!isRecord(persisted)) return current

        const normalized = normalizeLayout(persisted.layout)
        // A tree with no tabs carries no information; keep the default so a
        // stale empty entry cannot suppress the legacy seed.
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
