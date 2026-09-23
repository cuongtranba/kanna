import { create } from "zustand"
import { clampHighlight } from "../lib/quickSwitcher"

export type QuickSwitcherStep = "projects" | "sessions"

interface QuickSwitcherState {
  open: boolean
  step: QuickSwitcherStep
  query: string
  highlight: number
  projectId: string | null
  projectName: string
  openSwitcher: () => void
  closeSwitcher: () => void
  toggleSwitcher: () => void
  setQuery: (query: string) => void
  setHighlight: (highlight: number) => void
  moveHighlight: (delta: number, length: number) => void
  drillIntoProject: (projectId: string, projectName: string) => void
  backToProjects: () => void
}

const CLOSED = {
  open: false,
  step: "projects",
  query: "",
  highlight: 0,
  projectId: null,
  projectName: "",
} as const

export const useQuickSwitcherStore = create<QuickSwitcherState>()((set, get) => ({
  ...CLOSED,
  openSwitcher: () => set({ ...CLOSED, open: true }),
  closeSwitcher: () => set({ ...CLOSED }),
  toggleSwitcher: () => set(get().open ? { ...CLOSED } : { ...CLOSED, open: true }),
  setQuery: (query) => set({ query, highlight: 0 }),
  setHighlight: (highlight) => set({ highlight }),
  moveHighlight: (delta, length) => set({ highlight: clampHighlight(get().highlight + delta, length) }),
  drillIntoProject: (projectId, projectName) => set({
    step: "sessions",
    projectId,
    projectName,
    query: "",
    highlight: 0,
  }),
  backToProjects: () => set({
    step: "projects",
    projectId: null,
    projectName: "",
    query: "",
    highlight: 0,
  }),
}))
