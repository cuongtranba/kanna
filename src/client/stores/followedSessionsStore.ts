import { create } from "zustand"

const EMPTY: string[] = []

interface FollowedSessionsState {
  chatIds: string[]
  setFollowed(chatIds: string[]): void
}

export const useFollowedSessionsStore = create<FollowedSessionsState>()((set) => ({
  chatIds: EMPTY,
  setFollowed: (chatIds) => set({ chatIds }),
}))

export function selectIsFollowing(chatId: string | null | undefined) {
  return (s: FollowedSessionsState): boolean => (chatId ? s.chatIds.includes(chatId) : false)
}
