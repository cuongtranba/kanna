import { create } from "zustand"

interface BoardSyncState {
  syncingBoardId: string | null
  openCardId: string | null
  syncPanelOpen: boolean
  schemaPanelOpen: boolean
  messageByBoard: Record<string, string>
  renamingBoardId: string | null
  titleDraft: string
  openCard(cardId: string): void
  closeCard(): void
  openSyncPanel(): void
  closeSyncPanel(): void
  openSchemaPanel(): void
  closeSchemaPanel(): void
  startRenameBoard(boardId: string, currentTitle: string): void
  setTitleDraft(titleDraft: string): void
  stopRenameBoard(): void
  startSync(boardId: string): void
  finishSync(boardId: string, message: string): void
}

export const useBoardSyncStore = create<BoardSyncState>()((set) => ({
  syncingBoardId: null,
  openCardId: null,
  syncPanelOpen: false,
  schemaPanelOpen: false,
  messageByBoard: {},
  renamingBoardId: null,
  titleDraft: "",
  openCard: (openCardId) => set({ openCardId, syncPanelOpen: false, schemaPanelOpen: false }),
  closeCard: () => set({ openCardId: null }),
  openSyncPanel: () => set({ syncPanelOpen: true, openCardId: null, schemaPanelOpen: false }),
  closeSyncPanel: () => set({ syncPanelOpen: false }),
  openSchemaPanel: () => set({ schemaPanelOpen: true, openCardId: null, syncPanelOpen: false }),
  closeSchemaPanel: () => set({ schemaPanelOpen: false }),
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
