import { create } from "zustand"

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
