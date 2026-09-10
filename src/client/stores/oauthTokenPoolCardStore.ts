import { create } from "zustand"

export interface TokenRowState {
  testResult: string | null
  testing: boolean
}

interface OAuthTokenPoolCardState {
  addLabel: string
  addToken: string
  addBaseUrl: string
  addSubmitting: boolean

  tokenRowStates: Record<string, TokenRowState>
  baseUrlDrafts: Record<string, string>

  setAddLabel: (label: string) => void
  setAddToken: (token: string) => void
  setAddBaseUrl: (baseUrl: string) => void
  setAddSubmitting: (submitting: boolean) => void
  resetAddForm: () => void

  setTokenRowTesting: (id: string, testing: boolean) => void
  setTokenRowTestResult: (id: string, testResult: string | null) => void
  clearTokenRowState: (id: string) => void

  setBaseUrlDraft: (id: string, value: string) => void
  clearBaseUrlDraft: (id: string) => void
}

export const useOAuthTokenPoolCardStore = create<OAuthTokenPoolCardState>()((set) => ({
  addLabel: "",
  addToken: "",
  addBaseUrl: "",
  addSubmitting: false,
  tokenRowStates: {},
  baseUrlDrafts: {},

  setAddLabel: (addLabel) => set({ addLabel }),
  setAddToken: (addToken) => set({ addToken }),
  setAddBaseUrl: (addBaseUrl) => set({ addBaseUrl }),
  setAddSubmitting: (addSubmitting) => set({ addSubmitting }),
  resetAddForm: () => set({ addLabel: "", addToken: "", addBaseUrl: "" }),

  setTokenRowTesting: (id, testing) =>
    set((state) => ({
      tokenRowStates: {
        ...state.tokenRowStates,
        [id]: { ...(state.tokenRowStates[id] ?? { testResult: null, testing: false }), testing },
      },
    })),

  setTokenRowTestResult: (id, testResult) =>
    set((state) => ({
      tokenRowStates: {
        ...state.tokenRowStates,
        [id]: { ...(state.tokenRowStates[id] ?? { testResult: null, testing: false }), testResult },
      },
    })),

  clearTokenRowState: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.tokenRowStates
      return { tokenRowStates: rest }
    }),

  setBaseUrlDraft: (id, value) =>
    set((state) => ({ baseUrlDrafts: { ...state.baseUrlDrafts, [id]: value } })),

  clearBaseUrlDraft: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.baseUrlDrafts
      return { baseUrlDrafts: rest }
    }),
}))
