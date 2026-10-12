import { createScopedStore } from "../../lib/createScopedStore"

interface AskUserQuestionInteractiveState {
  currentIndex: number
  selections: Record<string, readonly string[]>
  customInputs: Record<string, string>
  setCurrentIndex: (currentIndex: number) => void
  toggleSelection: (key: string, label: string) => void
  selectOnly: (key: string, label: string) => void
  clearSelection: (key: string) => void
  setCustomInputs: (customInputs: Record<string, string>) => void
}

export const AskUserQuestionInteractiveStore = createScopedStore<void, AskUserQuestionInteractiveState>(
  "AskUserQuestionInteractive",
  () => (set) => ({
    currentIndex: 0,
    selections: {},
    customInputs: {},
    setCurrentIndex: (currentIndex) => set({ currentIndex }),
    toggleSelection: (key, label) =>
      set((state) => {
        const current = state.selections[key] ?? []
        const next = current.includes(label) ? current.filter((option) => option !== label) : [...current, label]
        return { selections: { ...state.selections, [key]: next } }
      }),
    selectOnly: (key, label) =>
      set((state) => ({ selections: { ...state.selections, [key]: [label] } })),
    clearSelection: (key) =>
      set((state) => ({ selections: { ...state.selections, [key]: [] } })),
    setCustomInputs: (customInputs) => set({ customInputs }),
  }),
)
