import { create } from "zustand"
import type { ChatSnapshot, TranscriptEntry } from "../../shared/types"
import { applyChatOps } from "../../shared/chat-ops"
import type { ChatOpsEvent } from "../../shared/chat-ops"

const EMPTY_OLDER_HISTORY_ENTRIES: TranscriptEntry[] = []

export interface ChatSlice {
  chatSnapshot: ChatSnapshot | null
  olderHistoryEntries: TranscriptEntry[]
  isHistoryLoading: boolean
  historyCursor: string | null
  hasOlderHistory: boolean
  chatReady: boolean
  chatResyncNonce: number
}

export const EMPTY_CHAT_SLICE: ChatSlice = {
  chatSnapshot: null,
  olderHistoryEntries: EMPTY_OLDER_HISTORY_ENTRIES,
  isHistoryLoading: false,
  historyCursor: null,
  hasOlderHistory: false,
  chatReady: false,
  chatResyncNonce: 0,
}

interface OptimisticProcessingEntry {
  ackedAt: number | null
}

function patchChat(state: ChatStateStoreState, chatId: string, patch: Partial<ChatSlice>): Pick<ChatStateStoreState, "chats"> {
  const current = state.chats[chatId] ?? EMPTY_CHAT_SLICE
  return {
    chats: {
      ...state.chats,
      [chatId]: { ...current, ...patch },
    },
  }
}

interface ChatStateStoreState {
  chats: Record<string, ChatSlice>
  optimisticProcessing: Record<string, OptimisticProcessingEntry>

  setChatSnapshot: (chatId: string, value: ChatSnapshot | null | ((current: ChatSnapshot | null) => ChatSnapshot | null)) => void
  setOlderHistoryEntries: (chatId: string, value: TranscriptEntry[] | ((current: TranscriptEntry[]) => TranscriptEntry[])) => void
  setIsHistoryLoading: (chatId: string, value: boolean) => void
  setHistoryCursor: (chatId: string, value: string | null) => void
  setHasOlderHistory: (chatId: string, value: boolean) => void
  adoptServerHistory: (chatId: string, history: { olderCursor: string | null; hasOlder: boolean }) => void
  setChatReady: (chatId: string, value: boolean) => void
  setChatResyncNonce: (chatId: string, value: number) => void
  bumpChatResyncNonce: (chatId: string) => void
  applyChatOpsEvent: (chatId: string, event: ChatOpsEvent) => "applied" | "stale" | "gap"
  releaseChat: (chatId: string) => void

  setOptimisticProcessing: (
    scopeId: string,
    value: OptimisticProcessingEntry | null | ((current: OptimisticProcessingEntry | null) => OptimisticProcessingEntry | null),
  ) => void
}

export function selectChatSlice(state: ChatStateStoreState, chatId: string): ChatSlice {
  return state.chats[chatId] ?? EMPTY_CHAT_SLICE
}

export const useChatStateStore = create<ChatStateStoreState>()((set) => ({
  chats: {},
  optimisticProcessing: {},

  setChatSnapshot: (chatId, value) =>
    set((state) => {
      const current = (state.chats[chatId] ?? EMPTY_CHAT_SLICE).chatSnapshot
      const next = typeof value === "function" ? value(current) : value
      return patchChat(state, chatId, { chatSnapshot: next })
    }),

  setOlderHistoryEntries: (chatId, value) =>
    set((state) => {
      const current = (state.chats[chatId] ?? EMPTY_CHAT_SLICE).olderHistoryEntries
      const next = typeof value === "function" ? value(current) : value
      return patchChat(state, chatId, { olderHistoryEntries: next })
    }),

  setIsHistoryLoading: (chatId, value) =>
    set((state) => patchChat(state, chatId, { isHistoryLoading: value })),

  setHistoryCursor: (chatId, value) =>
    set((state) => patchChat(state, chatId, { historyCursor: value })),

  setHasOlderHistory: (chatId, value) =>
    set((state) => patchChat(state, chatId, { hasOlderHistory: value })),

  adoptServerHistory: (chatId, history) =>
    set((state) => {
      const current = state.chats[chatId] ?? EMPTY_CHAT_SLICE
      if (current.olderHistoryEntries.length > 0) return state
      return patchChat(state, chatId, {
        historyCursor: history.olderCursor,
        hasOlderHistory: history.hasOlder,
      })
    }),

  setChatReady: (chatId, value) =>
    set((state) => patchChat(state, chatId, { chatReady: value })),

  setChatResyncNonce: (chatId, value) =>
    set((state) => patchChat(state, chatId, { chatResyncNonce: value })),

  bumpChatResyncNonce: (chatId) =>
    set((state) => {
      const current = (state.chats[chatId] ?? EMPTY_CHAT_SLICE).chatResyncNonce
      return patchChat(state, chatId, { chatResyncNonce: current + 1 })
    }),

  applyChatOpsEvent: (chatId, event) => {
    let result: "applied" | "stale" | "gap" = "stale"
    set((state) => {
      const current = (state.chats[chatId] ?? EMPTY_CHAT_SLICE).chatSnapshot
      if (!current || event.chatId !== chatId || current.runtime.chatId !== event.chatId) {
        result = "stale"
        return {}
      }
      if (current.seq === undefined) {
        result = "gap"
        return {}
      }
      if (event.toSeq <= current.seq) {
        result = "stale"
        return {}
      }
      if (event.fromSeq > current.seq + 1) {
        result = "gap"
        return {}
      }
      result = "applied"
      return patchChat(state, chatId, {
        chatSnapshot: applyChatOps(current, event.ops, event.toSeq),
      })
    })
    return result
  },

  releaseChat: (chatId) =>
    set((state) => {
      if (!(chatId in state.chats)) return {}
      const next = { ...state.chats }
      delete next[chatId]
      return { chats: next }
    }),

  setOptimisticProcessing: (scopeId, value) =>
    set((state) => {
      const current = state.optimisticProcessing[scopeId] ?? null
      const next = typeof value === "function" ? value(current) : value
      if (next === null) {
        if (!(scopeId in state.optimisticProcessing)) return {}
        const nextMap = { ...state.optimisticProcessing }
        delete nextMap[scopeId]
        return { optimisticProcessing: nextMap }
      }
      return {
        optimisticProcessing: {
          ...state.optimisticProcessing,
          [scopeId]: next,
        },
      }
    }),
}))
