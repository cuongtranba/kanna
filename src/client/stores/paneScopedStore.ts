import { noteTabActivated } from "../components/panes/paneRetention"
import type { OpenLocalLinkTarget } from "../components/messages/shared"
import { createScopedStore } from "../lib/createScopedStore"


interface PaneScopedState {
  layoutWidth: number
  setLayoutWidth: (width: number) => void

  localLinkMenuTarget: OpenLocalLinkTarget | null
  setLocalLinkMenuTarget: (target: OpenLocalLinkTarget | null) => void
  setLocalLinkMenuOpen: (open: boolean) => void

  diffRenderMode: "unified" | "split"
  wrapDiffLines: boolean
  setDiffRenderMode: (mode: "unified" | "split") => void
  setWrapDiffLines: (wrap: boolean) => void

  tabRecency: readonly string[]
  noteTabActivated: (tabId: string) => void
}

export const PaneScopedStore = createScopedStore<void, PaneScopedState>(
  "PaneScoped",
  () => (set) => ({
    layoutWidth: 0,
    setLayoutWidth: (width) => set({ layoutWidth: width }),

    localLinkMenuTarget: null,
    setLocalLinkMenuTarget: (target) => set({ localLinkMenuTarget: target }),
    setLocalLinkMenuOpen: (open) =>
      set((state) =>
        open || state.localLinkMenuTarget === null ? state : { localLinkMenuTarget: null },
      ),

    diffRenderMode: "unified",
    wrapDiffLines: false,
    setDiffRenderMode: (mode) => set({ diffRenderMode: mode }),
    setWrapDiffLines: (wrap) => set({ wrapDiffLines: wrap }),

    tabRecency: [],
    noteTabActivated: (tabId) =>
      set((state) => {
        const next = noteTabActivated(state.tabRecency, tabId)
        return next === state.tabRecency ? state : { tabRecency: next }
      }),
  }),
)
