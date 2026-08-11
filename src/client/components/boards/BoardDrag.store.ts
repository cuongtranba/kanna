import { create } from "zustand"
import type { CardDropTarget } from "../../lib/boards/dnd"

/**
 * What is being dragged, and where it would land.
 *
 * One drag at a time and one drop indicator at a time, so single slots cannot
 * drift from keyed maps. It lives in a store rather than component state
 * because the dragged card and the indicator are in different subtrees — the
 * card dims itself while a sibling column draws the line.
 *
 * Written only from drag-event callbacks, never during render.
 */
interface BoardDragState {
  draggingCardId: string | null
  cardDrop: CardDropTarget | null
  draggingColumnId: string | null
  /** The column the vertical indicator sits before; null means the far end. */
  columnDropBeforeId: string | null
  /** True while a column drag is live, so a null `columnDropBeforeId` reads as "the end". */
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

/** Whether the drop line belongs above this card right now. */
export function selectDropBeforeCard(columnId: string, cardId: string) {
  return (state: BoardDragState): boolean =>
    state.cardDrop?.columnId === columnId && state.cardDrop.beforeCardId === cardId
}

/** Whether the drop line belongs at the foot of this column right now. */
export function selectDropAtColumnEnd(columnId: string) {
  return (state: BoardDragState): boolean =>
    state.cardDrop?.columnId === columnId && state.cardDrop.beforeCardId === null
}
