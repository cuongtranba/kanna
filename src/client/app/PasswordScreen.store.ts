import { createScopedStore } from "../lib/createScopedStore"

interface PasswordScreenState {
  password: string
  submitting: boolean
  setPassword: (password: string) => void
  setSubmitting: (submitting: boolean) => void
}

export const PasswordScreenStore = createScopedStore<Record<string, never>, PasswordScreenState>(
  "PasswordScreen",
  () => (set) => ({
    password: "",
    submitting: false,
    setPassword: (password) => set({ password }),
    setSubmitting: (submitting) => set({ submitting }),
  }),
)
