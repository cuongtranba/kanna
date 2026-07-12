import { create } from "zustand"

type AppAuthStatus =
  | { status: "checking" }
  | { status: "ready" }
  | { status: "locked"; error: string | null }

interface AppShellState {
  authStatus: AppAuthStatus
  permissionsChatId: string | null
  setAuthStatus: (status: AppAuthStatus) => void
  setPermissionsChatId: (chatId: string | null) => void
}

export const useAppShellStore = create<AppShellState>()((set) => ({
  authStatus: { status: "checking" },
  permissionsChatId: null,
  setAuthStatus: (authStatus) => set({ authStatus }),
  setPermissionsChatId: (permissionsChatId) => set({ permissionsChatId }),
}))
