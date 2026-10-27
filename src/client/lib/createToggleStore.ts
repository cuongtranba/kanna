import { createScopedStore, type ScopedStore } from "./createScopedStore"

export interface ToggleState {
  value: boolean
  set: (value: boolean) => void
}

export function createToggleStore(displayName: string): ScopedStore<boolean, ToggleState> {
  return createScopedStore<boolean, ToggleState>(displayName, (initial) => (set) => ({
    value: initial,
    set: (value) => set({ value }),
  }))
}
