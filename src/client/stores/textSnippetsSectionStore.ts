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
  // TextSnippetsSection navigation
  editing: SnippetEditingState

  // SnippetEditor form (ONE active at a time)
  editorForm: SnippetEditorFormState

  // Actions — navigation
  setEditing: (editing: SnippetEditingState) => void

  // Actions — editor form
  resetEditorForm: (shortcut: string, expansion: string) => void
  setEditorShortcut: (shortcut: string) => void
  setEditorExpansion: (expansion: string) => void
  setEditorSubmitting: (submitting: boolean) => void
  setEditorError: (error: string | null) => void
}

export const useTextSnippetsSectionStore = create<TextSnippetsSectionState>()((set) => ({
  editing: { kind: "list" },
  editorForm: createEditorFormFromInitial("", ""),

  setEditing: (editing) => set({ editing }),

  resetEditorForm: (shortcut, expansion) =>
    set({ editorForm: createEditorFormFromInitial(shortcut, expansion) }),

  setEditorShortcut: (shortcut) =>
    set((state) => ({ editorForm: { ...state.editorForm, shortcut } })),
  setEditorExpansion: (expansion) =>
    set((state) => ({ editorForm: { ...state.editorForm, expansion } })),
  setEditorSubmitting: (submitting) =>
    set((state) => ({ editorForm: { ...state.editorForm, submitting } })),
  setEditorError: (error) =>
    set((state) => ({ editorForm: { ...state.editorForm, error } })),
}))
