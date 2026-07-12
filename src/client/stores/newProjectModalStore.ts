import { create } from "zustand"

export type NewProjectModalTab = "new" | "existing"

interface NewProjectModalState {
  tab: NewProjectModalTab
  name: string
  existingPath: string
  setTab: (tab: NewProjectModalTab) => void
  setName: (name: string) => void
  setExistingPath: (existingPath: string) => void
  resetForOpen: () => void
}

export const useNewProjectModalStore = create<NewProjectModalState>()((set) => ({
  tab: "new",
  name: "",
  existingPath: "",
  setTab: (tab) => set({ tab }),
  setName: (name) => set({ name }),
  setExistingPath: (existingPath) => set({ existingPath }),
  resetForOpen: () => set({ tab: "new", name: "", existingPath: "" }),
}))

export const useNewProjectTab = () => useNewProjectModalStore((state) => state.tab)
export const useNewProjectName = () => useNewProjectModalStore((state) => state.name)
export const useNewProjectExistingPath = () => useNewProjectModalStore((state) => state.existingPath)
