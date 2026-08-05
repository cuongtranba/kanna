import { create } from "zustand"
import type { PaneDropIntent } from "../components/panes/paneDropGeometry"

/**
 * Transient state for a tab drag.
 *
 * Lives in a store rather than in dnd-kit's context because the drop indicator
 * is rendered by the pane, which is nowhere near the draggable tab in the tree.
 *
 * Every write is guarded so an unchanged hover returns the identical state
 * object: a drag fires move events continuously, and publishing a fresh
 * snapshot per pixel would re-render every pane in the tree for the whole drag.
 */

interface PaneDragState {
  /** The tab being dragged, or null when no drag is in progress. */
  activeTabId: string | null
  /** The pane the pointer is currently over. */
  overPaneId: string | null
  /** What would happen on release, over `overPaneId`. */
  intent: PaneDropIntent | null

  beginDrag: (tabId: string) => void
  hoverPane: (paneId: string, intent: PaneDropIntent) => void
  clearHover: () => void
  endDrag: () => void
}

function sameIntent(a: PaneDropIntent | null, b: PaneDropIntent | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.kind !== b.kind) return false
  return a.kind === "split" && b.kind === "split" ? a.position === b.position : true
}

export const usePaneDragStore = create<PaneDragState>()((set) => ({
  activeTabId: null,
  overPaneId: null,
  intent: null,

  beginDrag: (tabId) =>
    set((state) => (state.activeTabId === tabId ? state : { activeTabId: tabId })),

  hoverPane: (paneId, intent) =>
    set((state) =>
      state.overPaneId === paneId && sameIntent(state.intent, intent)
        ? state
        : { overPaneId: paneId, intent },
    ),

  clearHover: () =>
    set((state) =>
      state.overPaneId === null && state.intent === null ? state : { overPaneId: null, intent: null },
    ),

  endDrag: () =>
    set((state) =>
      state.activeTabId === null && state.overPaneId === null && state.intent === null
        ? state
        : { activeTabId: null, overPaneId: null, intent: null },
    ),
}))
