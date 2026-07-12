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
  setEditorId: (id: string) => void
  setEditorLabel: (label: string) => void
  setEditorModelProvider: (provider: ModelProvider) => void
  setEditorSupportsEffort: (supportsEffort: boolean) => void
  setEditorSubmitting: (submitting: boolean) => void
  setEditorError: (error: string | null) => void
}

export const useModelsSectionStore = create<ModelsSectionState>()((set) => ({
  editing: { kind: "list" },
  editorForm: createEditorFormFromInitial("", "", "claude", false),

  setEditing: (editing) => set({ editing }),

  resetEditorForm: (id, label, modelProvider, supportsEffort) =>
    set({ editorForm: createEditorFormFromInitial(id, label, modelProvider, supportsEffort) }),

  setEditorId: (id) =>
    set((state) => ({ editorForm: { ...state.editorForm, id } })),
  setEditorLabel: (label) =>
    set((state) => ({ editorForm: { ...state.editorForm, label } })),
  setEditorModelProvider: (modelProvider) =>
    set((state) => ({ editorForm: { ...state.editorForm, modelProvider } })),
  setEditorSupportsEffort: (supportsEffort) =>
    set((state) => ({ editorForm: { ...state.editorForm, supportsEffort } })),
  setEditorSubmitting: (submitting) =>
    set((state) => ({ editorForm: { ...state.editorForm, submitting } })),
  setEditorError: (error) =>
    set((state) => ({ editorForm: { ...state.editorForm, error } })),
}))
