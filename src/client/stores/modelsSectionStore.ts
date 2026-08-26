import { create } from "zustand"
import type { ClaudeReasoningEffort } from "../../shared/types"

export type ModelProvider = "claude" | "codex"

export type ModelsEditingState =
  | { kind: "list" }
  | { kind: "create"; provider: ModelProvider }
  | { kind: "edit"; id: string }

export interface ModelEditorFormState {
  id: string
  label: string
  modelProvider: ModelProvider
  supportedEfforts: readonly ClaudeReasoningEffort[]
  submitting: boolean
  error: string | null
}

function createEditorFormFromInitial(
  id: string,
  label: string,
  modelProvider: ModelProvider,
  supportedEfforts: readonly ClaudeReasoningEffort[],
): ModelEditorFormState {
  return {
    id,
    label,
    modelProvider,
    supportedEfforts,
    submitting: false,
    error: null,
  }
}

interface ModelsSectionState {
  editing: ModelsEditingState
  editorForm: ModelEditorFormState

  // Actions — navigation
  setEditing: (editing: ModelsEditingState) => void

  // Actions — editor form
  resetEditorForm: (
    id: string,
    label: string,
    modelProvider: ModelProvider,
    supportedEfforts: readonly ClaudeReasoningEffort[],
  ) => void
  patchEditorForm: (patch: Partial<ModelEditorFormState>) => void
  toggleSupportedEffort: (effortId: ClaudeReasoningEffort) => void
}

export const useModelsSectionStore = create<ModelsSectionState>()((set) => ({
  editing: { kind: "list" },
  editorForm: createEditorFormFromInitial("", "", "claude", []),

  setEditing: (editing) => set({ editing }),

  resetEditorForm: (id, label, modelProvider, supportedEfforts) =>
    set({ editorForm: createEditorFormFromInitial(id, label, modelProvider, supportedEfforts) }),

  patchEditorForm: (patch) =>
    set((state) => ({ editorForm: { ...state.editorForm, ...patch } })),

  toggleSupportedEffort: (effortId) =>
    set((state) => {
      const current = state.editorForm.supportedEfforts
      const next = current.includes(effortId)
        ? current.filter((id) => id !== effortId)
        : [...current, effortId]
      return { editorForm: { ...state.editorForm, supportedEfforts: next } }
    }),
}))
