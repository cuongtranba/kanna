import { create } from "zustand"

/**
 * The new-card title being typed, per column.
 *
 * Keyed by column because every column has its own field and a reader may
 * start typing in one, look away, and add a card somewhere else — a single
 * draft would silently move their half-typed title to another column.
 *
 * A store rather than component state because the fields are rendered through
 * the kanban library's `renderListFooter` render prop, which remounts freely.
 */
interface CardAdderState {
  draftByColumn: Record<string, string>
  setDraft(columnId: string, draft: string): void
  clear(columnId: string): void
}

export const useCardAdderStore = create<CardAdderState>()((set) => ({
  draftByColumn: {},
  setDraft: (columnId, draft) =>
    set((state) => ({ draftByColumn: { ...state.draftByColumn, [columnId]: draft } })),
  clear: (columnId) =>
    set((state) => {
      if (!(columnId in state.draftByColumn)) return state
      const next = { ...state.draftByColumn }
      delete next[columnId]
      return { draftByColumn: next }
    }),
}))

export function selectCardDraft(columnId: string) {
  return (state: CardAdderState): string => state.draftByColumn[columnId] ?? ""
}
