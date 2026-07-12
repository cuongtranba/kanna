import { createScopedStore } from "../../lib/createScopedStore"

interface TerminalWorkspaceState {
  viewportWidth: number
  pathsByTerminalId: Record<string, string | null>
  clearVersionsByTerminalId: Record<string, number>
  setViewportWidth: (width: number) => void
  updatePath: (terminalId: string, path: string | null) => void
  incrementClearVersion: (terminalId: string) => void
}

export const TerminalWorkspaceStore = createScopedStore<void, TerminalWorkspaceState>(
  "TerminalWorkspace",
  () => (set) => ({
    viewportWidth: 0,
    pathsByTerminalId: {},
    clearVersionsByTerminalId: {},
    setViewportWidth: (width) => set({ viewportWidth: width }),
    updatePath: (terminalId, path) => set((state) => {
      if (state.pathsByTerminalId[terminalId] === path) return {}
      return { pathsByTerminalId: { ...state.pathsByTerminalId, [terminalId]: path } }
    }),
    incrementClearVersion: (terminalId) => set((state) => ({
      clearVersionsByTerminalId: {
        ...state.clearVersionsByTerminalId,
        [terminalId]: (state.clearVersionsByTerminalId[terminalId] ?? 0) + 1,
      },
    })),
  }),
)
