import { create } from "zustand"
import type { ClaudeReasoningEffort, CustomModelProvider } from "../../shared/types"
import { LIST_EDITING, type SectionEditing } from "../lib/sectionEditing"

export type ModelsEditingState = SectionEditing<{ provider: CustomModelProvider }>

export interface ModelEditorDraft {
  id: string
  label: string
  modelProvider: CustomModelProvider
  supportedEfforts: readonly ClaudeReasoningEffort[]
  offersOneMillionContext: boolean
}

export interface ModelEditorFormState extends ModelEditorDraft {
  error: string | null
}

const EMPTY_DRAFT: ModelEditorDraft = {
  id: "",
  label: "",
  modelProvider: "claude",
  supportedEfforts: [],
  offersOneMillionContext: false,
}

function createEditorFormFromInitial(draft: ModelEditorDraft): ModelEditorFormState {
  return { ...draft, error: null }
}

interface ModelsSectionState {
  editing: ModelsEditingState
  editorForm: ModelEditorFormState

  setEditing: (editing: ModelsEditingState) => void

  resetEditorForm: (draft: ModelEditorDraft) => void
  patchEditorForm: (patch: Partial<ModelEditorFormState>) => void
  toggleSupportedEffort: (effortId: ClaudeReasoningEffort) => void
  toggleOneMillionContext: () => void
}

export const useModelsSectionStore = create<ModelsSectionState>()((set) => ({
  editing: LIST_EDITING,
  editorForm: createEditorFormFromInitial(EMPTY_DRAFT),

  setEditing: (editing) => set({ editing }),

  resetEditorForm: (draft) => set({ editorForm: createEditorFormFromInitial(draft) }),

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

  toggleOneMillionContext: () =>
    set((state) => ({
      editorForm: {
        ...state.editorForm,
        offersOneMillionContext: !state.editorForm.offersOneMillionContext,
      },
    })),
}))
