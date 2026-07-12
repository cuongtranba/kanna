import { create } from "zustand"

export interface TokenRowState {
  testResult: string | null
  testing: boolean
}

interface OAuthTokenPoolCardState {
  // AddTokenForm state
  addLabel: string
  addToken: string
  addSubmitting: boolean

  // TokenRow per-row test state, keyed by token entry id
  tokenRowStates: Record<string, TokenRowState>

  // Actions — AddTokenForm
  setAddLabel: (label: string) => void
  setAddToken: (token: string) => void
  setAddSubmitting: (submitting: boolean) => void
  resetAddForm: () => void

  // Actions — TokenRow
  setTokenRowTesting: (id: string, testing: boolean) => void
  setTokenRowTestResult: (id: string, testResult: string | null) => void
  clearTokenRowState: (id: string) => void
}

export const useOAuthTokenPoolCardStore = create<OAuthTokenPoolCardState>()((set) => ({
  addLabel: "",
  addToken: "",
  addSubmitting: false,
  tokenRowStates: {},

  setAddLabel: (addLabel) => set({ addLabel }),
  setAddToken: (addToken) => set({ addToken }),
  setAddSubmitting: (addSubmitting) => set({ addSubmitting }),
  resetAddForm: () => set({ addLabel: "", addToken: "" }),

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
}))
