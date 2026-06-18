import { create } from "zustand"
import type { OpenRouterModel } from "../../shared/types"

const EMPTY: OpenRouterModel[] = []

interface OpenRouterModelsState {
  models: OpenRouterModel[]
  status: "idle" | "loading" | "ready" | "error"
  error: string | null
  setLoading(): void
  setModels(models: OpenRouterModel[]): void
  setError(message: string): void
}

export const useOpenRouterModelsStore = create<OpenRouterModelsState>()((set) => ({
  models: EMPTY,
  status: "idle",
  error: null,
  setLoading: () => set({ status: "loading", error: null }),
  setModels: (models) => set({ models, status: "ready", error: null }),
  setError: (message) => set({ status: "error", error: message }),
}))

export function selectOpenRouterModels(state: OpenRouterModelsState): OpenRouterModel[] {
  return state.models.length > 0 ? state.models : EMPTY
}
