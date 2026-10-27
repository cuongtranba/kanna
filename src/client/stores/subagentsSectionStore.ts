import { create } from "zustand"
import type { SubagentInput } from "../../shared/types"
import { LIST_EDITING, type SectionEditing } from "../lib/sectionEditing"
import { createDefaultSubagentDraft, type SubagentFieldError } from "../lib/subagentDraft"

export interface SubagentFormState {
  draft: SubagentInput
  error: SubagentFieldError | null
  confirmDelete: boolean
}

function createDefaultFormState(): SubagentFormState {
  return {
    draft: createDefaultSubagentDraft("claude", undefined),
    error: null,
    confirmDelete: false,
  }
}

interface SubagentsSectionState {
  editing: SectionEditing

  form: SubagentFormState

  timeoutDraft: string
  loopError: string | null

  setEditing: (editing: SectionEditing) => void

  resetForm: (draft: SubagentInput) => void
  patchForm: (patch: Partial<SubagentFormState>) => void
  patchFormDraft: (patch: Partial<SubagentInput>) => void

  setTimeoutDraft: (draft: string) => void
  setLoopError: (error: string | null) => void
}

export const useSubagentsSectionStore = create<SubagentsSectionState>()((set) => ({
  editing: LIST_EDITING,
  form: createDefaultFormState(),
  timeoutDraft: "",
  loopError: null,

  setEditing: (editing) => set({ editing }),

  resetForm: (draft) =>
    set({
      form: {
        draft,
        error: null,
            confirmDelete: false,
      },
    }),

  patchForm: (patch) =>
    set((state) => ({ form: { ...state.form, ...patch } })),

  patchFormDraft: (patch) =>
    set((state) => ({ form: { ...state.form, draft: { ...state.form.draft, ...patch } } })),

  setTimeoutDraft: (timeoutDraft) => set({ timeoutDraft }),
  setLoopError: (loopError) => set({ loopError }),
}))
