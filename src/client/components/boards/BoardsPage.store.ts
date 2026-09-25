import { create } from "zustand"
import type { BoardTemplate } from "../../../shared/boards/types"

const EMPTY_TEMPLATES: BoardTemplate[] = []

export type TemplatesStatus = "loading" | "ready" | "failed"

interface BoardsPageState {
  templates: BoardTemplate[]
  templatesStatus: TemplatesStatus
  openMenuId: string | null
  picking: boolean
  renamingId: string | null
  error: string | null
  setTemplates(templates: BoardTemplate[]): void
  beginTemplatesLoad(): void
  failTemplatesLoad(): void
  openMenu(boardId: string): void
  closeMenu(): void
  openPicker(): void
  closePicker(): void
  startRename(boardId: string): void
  stopRename(): void
  setError(error: string | null): void
}

export const useBoardsPageStore = create<BoardsPageState>()((set) => ({
  templates: EMPTY_TEMPLATES,
  templatesStatus: "loading",
  openMenuId: null,
  picking: false,
  renamingId: null,
  error: null,
  setTemplates: (templates) => set({ templates: Array.isArray(templates) ? templates : [], templatesStatus: "ready" }),
  beginTemplatesLoad: () => set({ templatesStatus: "loading" }),
  failTemplatesLoad: () => set({ templatesStatus: "failed" }),
  openMenu: (openMenuId) => set({ openMenuId }),
  closeMenu: () => set({ openMenuId: null }),
  openPicker: () => set({ picking: true, error: null }),
  closePicker: () => set({ picking: false }),
  startRename: (renamingId) => set({ renamingId, picking: false, openMenuId: null }),
  stopRename: () => set({ renamingId: null }),
  setError: (error) => set({ error }),
}))

export function selectTemplates(state: BoardsPageState): BoardTemplate[] {
  return state.templates
}
