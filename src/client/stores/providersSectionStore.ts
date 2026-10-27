import { create } from "zustand"
import type { JsonValue } from "../../shared/json"
import type { LlmProviderDraft } from "../lib/llmProviderDraft"

export type LlmValidationStatus = "idle" | "valid" | "invalid"

interface ProvidersSectionState {
  claudeIdleMinutesDraft: string
  claudeMaxConcurrentDraft: string
  llmProviderDraft: LlmProviderDraft
  llmProviderError: string | null
  llmValidationStatus: LlmValidationStatus
  llmValidationError: JsonValue | null
  llmValidationDialogOpen: boolean

  setClaudeIdleMinutesDraft: (draft: string) => void
  setClaudeMaxConcurrentDraft: (draft: string) => void
  setLlmProviderDraft: (draft: LlmProviderDraft) => void
  setLlmProviderError: (message: string | null) => void
  llmDraftChanged: () => void
  llmValidated: (status: LlmValidationStatus, error: JsonValue | null) => void
  setLlmValidationDialogOpen: (open: boolean) => void
}

export const useProvidersSectionStore = create<ProvidersSectionState>()((set) => ({
  claudeIdleMinutesDraft: "",
  claudeMaxConcurrentDraft: "",
  llmProviderDraft: { provider: "openai", apiKey: "", model: "", baseUrl: "" },
  llmProviderError: null,
  llmValidationStatus: "idle",
  llmValidationError: null,
  llmValidationDialogOpen: false,

  setClaudeIdleMinutesDraft: (claudeIdleMinutesDraft) => set({ claudeIdleMinutesDraft }),
  setClaudeMaxConcurrentDraft: (claudeMaxConcurrentDraft) => set({ claudeMaxConcurrentDraft }),
  setLlmProviderDraft: (llmProviderDraft) => set({ llmProviderDraft }),
  setLlmProviderError: (llmProviderError) => set({ llmProviderError }),
  llmDraftChanged: () => set({ llmValidationStatus: "idle", llmValidationError: null }),
  llmValidated: (llmValidationStatus, llmValidationError) => set({ llmValidationStatus, llmValidationError }),
  setLlmValidationDialogOpen: (llmValidationDialogOpen) => set({ llmValidationDialogOpen }),
}))
