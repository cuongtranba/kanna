import { create } from "zustand"

export interface BoardFilterState {
  text: string
  labels: readonly string[]
}

interface BoardFilterActions {
  setText(boardId: string, text: string): void
  setLabels(boardId: string, labels: readonly string[]): void
  clear(boardId: string): void
}

const EMPTY: BoardFilterState = { text: "", labels: [] }

export const useBoardFilterStore = create<
  { filterByBoard: Record<string, BoardFilterState> } & BoardFilterActions
>((set) => ({
  filterByBoard: {},
  setText: (boardId, text) =>
    set((s) => ({
      filterByBoard: {
        ...s.filterByBoard,
        [boardId]: { ...(s.filterByBoard[boardId] ?? EMPTY), text },
      },
    })),
  setLabels: (boardId, labels) =>
    set((s) => ({
      filterByBoard: {
        ...s.filterByBoard,
        [boardId]: { ...(s.filterByBoard[boardId] ?? EMPTY), labels },
      },
    })),
  clear: (boardId) =>
    set((s) => {
      const { [boardId]: _, ...rest } = s.filterByBoard
      return { filterByBoard: rest }
    }),
}))

export function selectBoardFilter(boardId: string) {
  return (state: { filterByBoard: Record<string, BoardFilterState> }): BoardFilterState =>
    state.filterByBoard[boardId] ?? EMPTY
}
