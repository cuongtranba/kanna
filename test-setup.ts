import { mock } from "bun:test"

mock.module("sonner", () => ({
  Toaster: () => null,
  toast: Object.assign(() => undefined, {
    success: () => undefined,
    error: () => undefined,
    info: () => undefined,
    warning: () => undefined,
    loading: () => undefined,
    dismiss: () => undefined,
  }),
  useSonner: () => ({ toasts: [] }),
}))
