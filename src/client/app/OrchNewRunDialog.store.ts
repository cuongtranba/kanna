import { createScopedStore } from "../lib/createScopedStore"

interface OrchNewRunDialogState {
  tasksText: string
  verify: string
  errors: string[]
  submitting: boolean
  setTasksText: (tasksText: string) => void
  setVerify: (verify: string) => void
  setErrors: (errors: string[]) => void
  setSubmitting: (submitting: boolean) => void
  reset: () => void
}

const EMPTY_ERRORS: string[] = []

export const OrchNewRunDialogStore = createScopedStore<void, OrchNewRunDialogState>(
  "OrchNewRunDialog",
  () => (set) => ({
    tasksText: "",
    verify: "",
    errors: EMPTY_ERRORS,
    submitting: false,
    setTasksText: (tasksText) => set({ tasksText }),
    setVerify: (verify) => set({ verify }),
    setErrors: (errors) => set({ errors }),
    setSubmitting: (submitting) => set({ submitting }),
    reset: () => set({ tasksText: "", verify: "", errors: EMPTY_ERRORS, submitting: false }),
  }),
)
