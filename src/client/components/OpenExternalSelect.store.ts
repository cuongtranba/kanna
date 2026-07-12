import { createScopedStore } from "../lib/createScopedStore"
import type { OpenAppValue } from "./open-external-menu"

interface OpenExternalSelectState {
  lastValue: OpenAppValue
  setLastValue: (value: OpenAppValue) => void
}

export const OpenExternalSelectStore = createScopedStore<{ initialValue: OpenAppValue }, OpenExternalSelectState>(
  "OpenExternalSelect",
  ({ initialValue }) => (set) => ({
    lastValue: initialValue,
    setLastValue: (lastValue) => set({ lastValue }),
  }),
)
