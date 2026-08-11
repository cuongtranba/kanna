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
  /**
   * The board whose title is being edited, and the title as typed.
   *
   * Keyed by board id rather than a bare boolean so a second board tab can
   * never inherit the first one's open editor.
   */
  renamingBoardId: string | null
  titleDraft: string
  openCard(cardId: string): void
  closeCard(): void
  openSyncPanel(): void
  closeSyncPanel(): void
  startRenameBoard(boardId: string, currentTitle: string): void
  setTitleDraft(titleDraft: string): void
  /** Dismiss the editor. Discarding is what makes clicking away a cancel. */
  stopRenameBoard(): void
  startSync(boardId: string): void
  finishSync(boardId: string, message: string): void
}

export const useBoardSyncStore = create<BoardSyncState>()((set) => ({
  syncingBoardId: null,
  openCardId: null,
  syncPanelOpen: false,
  messageByBoard: {},
  renamingBoardId: null,
  titleDraft: "",
  // One aside at a time: both overlay the same columns, and stacking them would
  // hide the board the reader is deciding about.
  openCard: (openCardId) => set({ openCardId, syncPanelOpen: false }),
  closeCard: () => set({ openCardId: null }),
  openSyncPanel: () => set({ syncPanelOpen: true, openCardId: null }),
  closeSyncPanel: () => set({ syncPanelOpen: false }),
  startRenameBoard: (renamingBoardId, currentTitle) => set({ renamingBoardId, titleDraft: currentTitle }),
  setTitleDraft: (titleDraft) => set({ titleDraft }),
  stopRenameBoard: () => set({ renamingBoardId: null, titleDraft: "" }),
  startSync: (syncingBoardId) => set({ syncingBoardId }),
  finishSync: (boardId, message) =>
    set((state) => ({
      syncingBoardId: state.syncingBoardId === boardId ? null : state.syncingBoardId,
      messageByBoard: { ...state.messageByBoard, [boardId]: message },
    })),
}))
