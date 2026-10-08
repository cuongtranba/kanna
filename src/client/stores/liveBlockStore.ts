import { create } from "zustand"
import type { LiveBlock } from "../../shared/live-block"

interface LiveBlockState {
  byChat: Record<string, LiveBlock>
  setLiveBlock(chatId: string, block: LiveBlock | null): void
}

export const useLiveBlockStore = create<LiveBlockState>()((set) => ({
  byChat: {},
  setLiveBlock: (chatId, block) =>
    set((state) => {
      if (block === null) {
        if (!(chatId in state.byChat)) return state
        const { [chatId]: _removed, ...rest } = state.byChat
        return { byChat: rest }
      }
      return { byChat: { ...state.byChat, [chatId]: block } }
    }),
}))

export function selectLiveBlock(chatId: string | null) {
  return (state: LiveBlockState): LiveBlock | null =>
    chatId === null ? null : (state.byChat[chatId] ?? null)
}
