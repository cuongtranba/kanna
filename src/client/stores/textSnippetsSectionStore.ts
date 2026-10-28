import { create } from "zustand"
import { LIST_EDITING, type SectionEditing } from "../lib/sectionEditing"

export interface SnippetEditorFormState {
  shortcut: string
  expansion: string
  error: string | null
}

function createEditorFormFromInitial(
  shortcut: string,
  expansion: string,
): SnippetEditorFormState {
  return {
    shortcut,
    expansion,
    error: null,
  }
}

interface TextSnippetsSectionState {
  editing: SectionEditing

  editorForm: SnippetEditorFormState

  setEditing: (editing: SectionEditing) => void

  resetEditorForm: (shortcut: string, expansion: string) => void
  patchEditorForm: (patch: Partial<SnippetEditorFormState>) => void
}

export const useTextSnippetsSectionStore = create<TextSnippetsSectionState>()((set) => ({
  editing: LIST_EDITING,
  editorForm: createEditorFormFromInitial("", ""),

  setEditing: (editing) => set({ editing }),

  resetEditorForm: (shortcut, expansion) =>
    set({ editorForm: createEditorFormFromInitial(shortcut, expansion) }),

  patchEditorForm: (patch) =>
    set((state) => ({ editorForm: { ...state.editorForm, ...patch } })),
}))
