import { create } from "zustand"

export type PushPermissionState =
  | "unsupported"
  | "insecure-context"
  | "default"
  | "granted"
  | "denied"

interface PushSettingsState {
  permissionState: PushPermissionState
  deviceId: string | null
  error: string | null
  contactSubjectDraft: string

  detected: (permissionState: PushPermissionState, deviceId: string | null) => void
  setPermissionState: (permissionState: PushPermissionState) => void
  setDeviceId: (deviceId: string | null) => void
  setError: (message: string | null) => void
  setContactSubjectDraft: (draft: string) => void
}

export const usePushSettingsStore = create<PushSettingsState>()((set) => ({
  permissionState: "unsupported",
  deviceId: null,
  error: null,
  contactSubjectDraft: "",

  detected: (permissionState, deviceId) => set({ permissionState, deviceId }),
  setPermissionState: (permissionState) => set({ permissionState }),
  setDeviceId: (deviceId) => set({ deviceId }),
  setError: (error) => set({ error }),
  setContactSubjectDraft: (contactSubjectDraft) => set({ contactSubjectDraft }),
}))
