import { create } from "zustand"

export type ModelProvider = "claude" | "codex"

export type ModelsEditingState =
  | { kind: "list" }
  | { kind: "create"; provider: ModelProvider }
  | { kind: "edit"; id: string }

export interface ModelEditorFormState {
  id: string
  label: string
  modelProvider: ModelProvider
  supportsEffort: boolean
  submitting: boolean
  error: string | null
}

function createEditorFormFromInitial(
  id: string,
  label: string,
  modelProvider: ModelProvider,
  supportsEffort: boolean,
): ModelEditorFormState {
  return {
    id,
    label,
    modelProvider,
    supportsEffort,
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
    supportsEffort: boolean,
  ) => void
  patchEditorForm: (patch: Partial<ModelEditorFormState>) => void
}

export const useModelsSectionStore = create<ModelsSectionState>()((set) => ({
  editing: { kind: "list" },
  editorForm: createEditorFormFromInitial("", "", "claude", false),

  setEditing: (editing) => set({ editing }),

  resetEditorForm: (id, label, modelProvider, supportsEffort) =>
    set({ editorForm: createEditorFormFromInitial(id, label, modelProvider, supportsEffort) }),

  patchEditorForm: (patch) =>
    set((state) => ({ editorForm: { ...state.editorForm, ...patch } })),
}))
