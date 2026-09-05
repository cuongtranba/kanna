import { create } from "zustand"
import type { BoardTemplate } from "../../../shared/boards/types"

const EMPTY_TEMPLATES: BoardTemplate[] = []

interface BoardsPageState {
  templates: BoardTemplate[]
  openMenuId: string | null
  picking: boolean
  renamingId: string | null
  error: string | null
  setTemplates(templates: BoardTemplate[]): void
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
  openMenuId: null,
  picking: false,
  renamingId: null,
  error: null,
  setTemplates: (templates) => set({ templates: Array.isArray(templates) ? templates : [] }),
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
