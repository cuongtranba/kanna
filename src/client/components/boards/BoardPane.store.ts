import { create } from "zustand"

/**
 * Sync state for the board header.
 *
 * One board syncs at a time — the button is the only trigger and it disables
 * itself — so a single in-flight id is enough, and it cannot drift from a set.
 */
interface BoardSyncState {
  syncingBoardId: string | null
  /** The card whose drawer is open, if any. */
  openCardId: string | null
  /** Whether the sync settings panel is open. Mutually exclusive with the drawer. */
  syncPanelOpen: boolean
  /** Last outcome per board, rendered inline on the header rather than as a toast. */
  messageByBoard: Record<string, string>
  openCard(cardId: string): void
  closeCard(): void
  openSyncPanel(): void
  closeSyncPanel(): void
  startSync(boardId: string): void
  finishSync(boardId: string, message: string): void
}

export const useBoardSyncStore = create<BoardSyncState>()((set) => ({
  syncingBoardId: null,
  openCardId: null,
  syncPanelOpen: false,
  messageByBoard: {},
  // One aside at a time: both overlay the same columns, and stacking them would
  // hide the board the reader is deciding about.
  openCard: (openCardId) => set({ openCardId, syncPanelOpen: false }),
  closeCard: () => set({ openCardId: null }),
  openSyncPanel: () => set({ syncPanelOpen: true, openCardId: null }),
  closeSyncPanel: () => set({ syncPanelOpen: false }),
  startSync: (syncingBoardId) => set({ syncingBoardId }),
  finishSync: (boardId, message) =>
    set((state) => ({
      syncingBoardId: state.syncingBoardId === boardId ? null : state.syncingBoardId,
      messageByBoard: { ...state.messageByBoard, [boardId]: message },
    })),
}))
