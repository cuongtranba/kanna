import { create } from "zustand"

interface SidebarSelectionState {
  selectedChatIds: ReadonlySet<string>
  isSelecting: boolean
  anchorChatId: string | null
  startSelecting: () => void
  stopSelecting: () => void
  toggle: (chatId: string) => void
  selectRange: (orderedChatIds: readonly string[], chatId: string, fallbackAnchorId: string | null) => void
  selectAll: (chatIds: string[]) => void
  clearAll: () => void
}

export const useSidebarSelectionStore = create<SidebarSelectionState>((set) => ({
  selectedChatIds: new Set<string>(),
  isSelecting: false,
  anchorChatId: null,

  startSelecting: () => set({ isSelecting: true, selectedChatIds: new Set<string>(), anchorChatId: null }),
  stopSelecting: () => set({ isSelecting: false, selectedChatIds: new Set<string>(), anchorChatId: null }),

  toggle: (chatId) =>
    set((state) => {
      const next = new Set(state.selectedChatIds)
      if (next.has(chatId)) {
        next.delete(chatId)
      } else {
        next.add(chatId)
      }
      return { selectedChatIds: next, isSelecting: true, anchorChatId: chatId }
    }),

  selectRange: (orderedChatIds, chatId, fallbackAnchorId) =>
    set((state) => {
      const anchorId = state.anchorChatId ?? fallbackAnchorId
      const anchorIndex = anchorId === null ? -1 : orderedChatIds.indexOf(anchorId)
      const targetIndex = orderedChatIds.indexOf(chatId)
      const next = new Set(state.selectedChatIds)
      if (anchorIndex === -1 || targetIndex === -1) {
        if (next.has(chatId)) {
          next.delete(chatId)
        } else {
          next.add(chatId)
        }
        return { selectedChatIds: next, isSelecting: true, anchorChatId: chatId }
      }
      const from = Math.min(anchorIndex, targetIndex)
      const to = Math.max(anchorIndex, targetIndex)
      for (const id of orderedChatIds.slice(from, to + 1)) next.add(id)
      return { selectedChatIds: next, isSelecting: true, anchorChatId: anchorId }
    }),

  selectAll: (chatIds) =>
    set({ selectedChatIds: new Set(chatIds) }),

  clearAll: () => set({ selectedChatIds: new Set<string>(), anchorChatId: null }),
}))
