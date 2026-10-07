import { create } from "zustand"

export interface ComposerFocusRequest {
  chatId: string
  nonce: number
}

interface ComposerFocusState {
  request: ComposerFocusRequest | null
  requestComposerFocus: (chatId: string) => void
  consumeComposerFocus: (nonce: number) => void
}

export const useComposerFocusStore = create<ComposerFocusState>()((set, get) => ({
  request: null,
  requestComposerFocus: (chatId) => {
    set({ request: { chatId, nonce: (get().request?.nonce ?? 0) + 1 } })
  },
  consumeComposerFocus: (nonce) => {
    if (get().request?.nonce === nonce) set({ request: null })
  },
}))
