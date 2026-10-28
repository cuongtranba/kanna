import { noteTabActivated } from "../components/panes/paneRetention"
import { createScopedStore } from "../lib/createScopedStore"

interface PaneScopedState {
  layoutWidth: number
  setLayoutWidth: (width: number) => void

  tabRecency: readonly string[]
  noteTabActivated: (tabId: string) => void
}

export const PaneScopedStore = createScopedStore<void, PaneScopedState>(
  "PaneScoped",
  () => (set) => ({
    layoutWidth: 0,
    setLayoutWidth: (width) => set({ layoutWidth: width }),

    tabRecency: [],
    noteTabActivated: (tabId) =>
      set((state) => {
        const next = noteTabActivated(state.tabRecency, tabId)
        return next === state.tabRecency ? state : { tabRecency: next }
      }),
  }),
)
