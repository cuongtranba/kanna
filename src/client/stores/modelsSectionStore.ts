import { create } from "zustand"
import type { ClaudeReasoningEffort } from "../../shared/types"

export type ModelProvider = "claude" | "codex"

export type ModelsEditingState =
  | { kind: "list" }
  | { kind: "create"; provider: ModelProvider }
  | { kind: "edit"; id: string }

export interface ModelEditorDraft {
  id: string
  label: string
  modelProvider: ModelProvider
  supportedEfforts: readonly ClaudeReasoningEffort[]
  offersOneMillionContext: boolean
}

export interface ModelEditorFormState extends ModelEditorDraft {
  submitting: boolean
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
  return { ...draft, submitting: false, error: null }
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
  editing: { kind: "list" },
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
