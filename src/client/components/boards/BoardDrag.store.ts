import { create } from "zustand"
import type { CardDropTarget } from "../../lib/boards/dnd"

interface BoardDragState {
  draggingCardId: string | null
  cardDrop: CardDropTarget | null
  draggingColumnId: string | null
  columnDropBeforeId: string | null
  columnDropActive: boolean
  startCardDrag(cardId: string): void
  setCardDrop(target: CardDropTarget | null): void
  startColumnDrag(columnId: string): void
  setColumnDrop(beforeColumnId: string | null, active: boolean): void
  endDrag(): void
}

export const useBoardDragStore = create<BoardDragState>()((set) => ({
  draggingCardId: null,
  cardDrop: null,
  draggingColumnId: null,
  columnDropBeforeId: null,
  columnDropActive: false,
  startCardDrag: (draggingCardId) => set({ draggingCardId, cardDrop: null }),
  setCardDrop: (cardDrop) => set({ cardDrop }),
  startColumnDrag: (draggingColumnId) =>
    set({ draggingColumnId, columnDropBeforeId: null, columnDropActive: false }),
  setColumnDrop: (columnDropBeforeId, columnDropActive) => set({ columnDropBeforeId, columnDropActive }),
  endDrag: () =>
    set({
      draggingCardId: null,
      cardDrop: null,
      draggingColumnId: null,
      columnDropBeforeId: null,
      columnDropActive: false,
    }),
}))

export function selectDropBeforeCard(columnId: string, cardId: string) {
  return (state: BoardDragState): boolean =>
    state.cardDrop?.columnId === columnId && state.cardDrop.beforeCardId === cardId
}

export function selectDropAtColumnEnd(columnId: string) {
  return (state: BoardDragState): boolean =>
    state.cardDrop?.columnId === columnId && state.cardDrop.beforeCardId === null
}
