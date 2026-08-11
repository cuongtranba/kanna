import { create } from "zustand"
import { isColumnColorToken, isColumnSemantic } from "../../../shared/boards/types"
import type { ColumnSettingsValue } from "./ColumnSettings"

/**
 * The open column editor's draft.
 *
 * One popover is open at a time, so a single draft cannot drift from a keyed
 * map. Opening seeds the draft from the column; closing discards it, which is
 * what makes dismissing the popover a real cancel rather than a silent save.
 *
 * The setters take the RAW input value and narrow here, so the component never
 * has to cast a `<select>` value or parse a number in a JSX attribute.
 */
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
  // A limit is a count. Anything that is not a positive whole number means none,
  // so a half-typed value can never become a limit of 0 that silences the badge.
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
