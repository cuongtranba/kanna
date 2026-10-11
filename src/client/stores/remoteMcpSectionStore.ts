import { create } from "zustand"

interface RemoteMcpSectionState {
  publicUrlDraft: string | null
  copiedSnippetId: string | null
  error: string | null
  setPublicUrlDraft: (draft: string | null) => void
  setCopiedSnippetId: (id: string | null) => void
  setError: (error: string | null) => void
}

export const useRemoteMcpSectionStore = create<RemoteMcpSectionState>()((set) => ({
  publicUrlDraft: null,
  copiedSnippetId: null,
  error: null,
  setPublicUrlDraft: (publicUrlDraft) => set({ publicUrlDraft }),
  setCopiedSnippetId: (copiedSnippetId) => set({ copiedSnippetId }),
  setError: (error) => set({ error }),
}))
