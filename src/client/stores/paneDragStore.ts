import { create } from "zustand"
import type { PaneDropIntent } from "../components/panes/paneDropGeometry"


interface PaneDragState {
  activeTabId: string | null
  overPaneId: string | null
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
