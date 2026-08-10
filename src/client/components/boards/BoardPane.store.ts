import { create } from "zustand"

/**
 * Sync state for the board header.
 *
 * One board syncs at a time — the button is the only trigger and it disables
 * itself — so a single in-flight id is enough, and it cannot drift from a set.
 */
interface BoardSyncState {
  syncingBoardId: string | null
  /** Last outcome per board, rendered inline on the header rather than as a toast. */
  messageByBoard: Record<string, string>
  startSync(boardId: string): void
  finishSync(boardId: string, message: string): void
}

export const useBoardSyncStore = create<BoardSyncState>()((set) => ({
  syncingBoardId: null,
  messageByBoard: {},
  startSync: (syncingBoardId) => set({ syncingBoardId }),
  finishSync: (boardId, message) =>
    set((state) => ({
      syncingBoardId: state.syncingBoardId === boardId ? null : state.syncingBoardId,
      messageByBoard: { ...state.messageByBoard, [boardId]: message },
    })),
}))
