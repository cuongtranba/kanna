import { create } from "zustand"

export interface GeneralSettingsDrafts {
  scrollback: string
  minColumnWidth: string
  tabMinWidth: string
  uploadMaxFileSize: string
  editorCommand: string
  cloudflaredPath: string
  shareDefaultTtl: string
}

interface GeneralSettingsState {
  drafts: GeneralSettingsDrafts
  appSettingsError: string | null
  tunnelError: string | null
  analyticsDialogOpen: boolean

  patchDrafts: (patch: Partial<GeneralSettingsDrafts>) => void
  setAppSettingsError: (message: string | null) => void
  setTunnelError: (message: string | null) => void
  setAnalyticsDialogOpen: (open: boolean) => void
}

export const useGeneralSettingsStore = create<GeneralSettingsState>()((set) => ({
  drafts: {
    scrollback: "",
    minColumnWidth: "",
    tabMinWidth: "",
    uploadMaxFileSize: "",
    editorCommand: "",
    cloudflaredPath: "",
    shareDefaultTtl: "",
  },
  appSettingsError: null,
  tunnelError: null,
  analyticsDialogOpen: false,

  patchDrafts: (patch) => set((state) => ({ drafts: { ...state.drafts, ...patch } })),
  setAppSettingsError: (appSettingsError) => set({ appSettingsError }),
  setTunnelError: (tunnelError) => set({ tunnelError }),
  setAnalyticsDialogOpen: (analyticsDialogOpen) => set({ analyticsDialogOpen }),
}))
