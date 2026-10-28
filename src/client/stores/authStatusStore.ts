import { create } from "zustand"

interface AuthStatusState {
  authEnabled: boolean
  setAuthEnabled: (enabled: boolean) => void
}

export const useAuthStatusStore = create<AuthStatusState>()((set) => ({
  authEnabled: false,
  setAuthEnabled: (authEnabled) => set({ authEnabled }),
}))
