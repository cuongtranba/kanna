import type { StateCreator } from "zustand"
import { createScopedStore } from "../../lib/createScopedStore"

export interface BoardPaneUiState {
  syncing: boolean
  message: string | null
  openCardId: string | null
  syncPanelOpen: boolean
  schemaPanelOpen: boolean
  renaming: boolean
  titleDraft: string
  openCard(cardId: string): void
  closeCard(): void
  openSyncPanel(): void
  closeSyncPanel(): void
  openSchemaPanel(): void
  closeSchemaPanel(): void
  startRename(currentTitle: string): void
  setTitleDraft(titleDraft: string): void
  stopRename(): void
  startSync(): void
  finishSync(summary: string): void
  reportMessage(message: string): void
}

export const createBoardPaneUiState: StateCreator<BoardPaneUiState> = (set) => ({
  syncing: false,
  message: null,
  openCardId: null,
  syncPanelOpen: false,
  schemaPanelOpen: false,
  renaming: false,
  titleDraft: "",
  openCard: (openCardId) => set({ openCardId, syncPanelOpen: false, schemaPanelOpen: false }),
  closeCard: () => set({ openCardId: null }),
  openSyncPanel: () => set({ syncPanelOpen: true, openCardId: null, schemaPanelOpen: false }),
  closeSyncPanel: () => set({ syncPanelOpen: false }),
  openSchemaPanel: () => set({ schemaPanelOpen: true, openCardId: null, syncPanelOpen: false }),
  closeSchemaPanel: () => set({ schemaPanelOpen: false }),
  startRename: (currentTitle) => set({ renaming: true, titleDraft: currentTitle }),
  setTitleDraft: (titleDraft) => set({ titleDraft }),
  stopRename: () => set({ renaming: false, titleDraft: "" }),
  startSync: () => set({ syncing: true }),
  finishSync: (summary) => set({ syncing: false, message: summary }),
  reportMessage: (message) => set({ message }),
})

export const BoardPaneStore = createScopedStore<void, BoardPaneUiState>(
  "BoardPane",
  () => createBoardPaneUiState,
)
