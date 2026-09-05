import { create } from "zustand"
import { isColumnColorToken, isColumnSemantic } from "../../../shared/boards/types"
import type { ColumnSettingsValue } from "./ColumnSettings"

interface ColumnSettingsState {
  openColumnId: string | null
  draft: ColumnSettingsValue
  open(columnId: string, value: ColumnSettingsValue): void
  close(): void
  setTitle(title: string): void
  setSemantic(raw: string): void
  setColorToken(raw: string): void
  setWipLimit(raw: string): void
}

const EMPTY_DRAFT: ColumnSettingsValue = {
  title: "",
  semantic: null,
  colorToken: null,
  wipLimit: null,
}

export const useColumnSettingsStore = create<ColumnSettingsState>()((set) => ({
  openColumnId: null,
  draft: EMPTY_DRAFT,
  open: (openColumnId, value) => set({ openColumnId, draft: value }),
  close: () => set({ openColumnId: null, draft: EMPTY_DRAFT }),
  setTitle: (title) => set((state) => ({ draft: { ...state.draft, title } })),
  setSemantic: (raw) =>
    set((state) => ({ draft: { ...state.draft, semantic: isColumnSemantic(raw) ? raw : null } })),
  setColorToken: (raw) =>
    set((state) => ({ draft: { ...state.draft, colorToken: isColumnColorToken(raw) ? raw : null } })),
  setWipLimit: (raw) =>
    set((state) => {
      const parsed = Number.parseInt(raw.trim(), 10)
      return {
        draft: {
          ...state.draft,
          wipLimit: Number.isInteger(parsed) && parsed > 0 ? parsed : null,
        },
      }
    }),
}))
