import { create } from "zustand"

interface ImportSessionsDialogState {
  text: string
  setText: (text: string) => void
  resetForOpen: () => void
}

export const useImportSessionsDialogStore = create<ImportSessionsDialogState>()((set) => ({
  text: "",
  setText: (text) => set({ text }),
  resetForOpen: () => set({ text: "" }),
}))

export const useImportSessionsDialogText = () => useImportSessionsDialogStore((state) => state.text)
