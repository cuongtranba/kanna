import { createScopedStore } from "../../lib/createScopedStore"

interface AskUserQuestionInteractiveState {
  currentIndex: number
  answers: Record<string, string>
  customInputs: Record<string, string>
  setCurrentIndex: (currentIndex: number) => void
  setAnswers: (answers: Record<string, string>) => void
  setCustomInputs: (customInputs: Record<string, string>) => void
}

export const AskUserQuestionInteractiveStore = createScopedStore<void, AskUserQuestionInteractiveState>(
  "AskUserQuestionInteractive",
  () => (set) => ({
    currentIndex: 0,
    answers: {},
    customInputs: {},
    setCurrentIndex: (currentIndex) => set({ currentIndex }),
    setAnswers: (answers) => set({ answers }),
    setCustomInputs: (customInputs) => set({ customInputs }),
  }),
)
