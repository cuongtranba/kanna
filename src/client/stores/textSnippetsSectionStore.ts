import { create } from "zustand"

export type SnippetEditingState =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; id: string }

export interface SnippetEditorFormState {
  shortcut: string
  expansion: string
  submitting: boolean
  error: string | null
}

function createEditorFormFromInitial(
  shortcut: string,
  expansion: string,
): SnippetEditorFormState {
  return {
    shortcut,
    expansion,
    submitting: false,
    error: null,
  }
}

interface TextSnippetsSectionState {
  editing: SnippetEditingState

  editorForm: SnippetEditorFormState

  setEditing: (editing: SnippetEditingState) => void

  resetEditorForm: (shortcut: string, expansion: string) => void
  patchEditorForm: (patch: Partial<SnippetEditorFormState>) => void
}

export const useTextSnippetsSectionStore = create<TextSnippetsSectionState>()((set) => ({
  editing: { kind: "list" },
  editorForm: createEditorFormFromInitial("", ""),

  setEditing: (editing) => set({ editing }),

  resetEditorForm: (shortcut, expansion) =>
    set({ editorForm: createEditorFormFromInitial(shortcut, expansion) }),

  patchEditorForm: (patch) =>
    set((state) => ({ editorForm: { ...state.editorForm, ...patch } })),
}))
