import { create } from "zustand"

interface RemoteMcpSectionState {
  publicUrlDraft: string | null
  error: string | null
  setPublicUrlDraft: (draft: string | null) => void
  setError: (error: string | null) => void
}

export const useRemoteMcpSectionStore = create<RemoteMcpSectionState>()((set) => ({
  publicUrlDraft: null,
  error: null,
  setPublicUrlDraft: (publicUrlDraft) => set({ publicUrlDraft }),
  setError: (error) => set({ error }),
}))
