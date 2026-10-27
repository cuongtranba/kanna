import { createScopedStore } from "../lib/createScopedStore"
import type { OpenAppTarget } from "./open-external-menu"

interface OpenExternalSelectState {
  lastTarget: OpenAppTarget
  setLastTarget: (target: OpenAppTarget) => void
}

export const OpenExternalSelectStore = createScopedStore<{ initialTarget: OpenAppTarget }, OpenExternalSelectState>(
  "OpenExternalSelect",
  ({ initialTarget }) => (set) => ({
    lastTarget: initialTarget,
    setLastTarget: (lastTarget) => set({ lastTarget }),
  }),
)
