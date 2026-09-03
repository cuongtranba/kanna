import { create } from "zustand"

interface SidebarSelectionState {
  selectedChatIds: ReadonlySet<string>
  isSelecting: boolean
  startSelecting: () => void
  stopSelecting: () => void
  toggle: (chatId: string) => void
  selectAll: (chatIds: string[]) => void
  clearAll: () => void
}

export const useSidebarSelectionStore = create<SidebarSelectionState>((set) => ({
  selectedChatIds: new Set<string>(),
  isSelecting: false,

  startSelecting: () => set({ isSelecting: true, selectedChatIds: new Set<string>() }),
  stopSelecting: () => set({ isSelecting: false, selectedChatIds: new Set<string>() }),

  toggle: (chatId) =>
    set((state) => {
      const next = new Set(state.selectedChatIds)
      if (next.has(chatId)) {
        next.delete(chatId)
      } else {
        next.add(chatId)
      }
      return { selectedChatIds: next }
    }),

  selectAll: (chatIds) =>
    set({ selectedChatIds: new Set(chatIds) }),

  clearAll: () => set({ selectedChatIds: new Set<string>() }),
}))
