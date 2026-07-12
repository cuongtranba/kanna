import { create } from "zustand"
import {
  DEFAULT_CLAUDE_MODEL_OPTIONS,
  getProviderCatalog,
  type SubagentInput,
} from "../../shared/types"
import type { SubagentFieldError, SubagentsEditingState } from "../app/SubagentsSection"

export type { SubagentsEditingState }

export interface SubagentFormState {
  draft: SubagentInput
  error: SubagentFieldError | null
  pending: boolean
  confirmDelete: boolean
}

function createDefaultDraft(): SubagentInput {
  return {
    name: "",
    provider: "claude",
    model: getProviderCatalog("claude").defaultModel,
    modelOptions: { ...DEFAULT_CLAUDE_MODEL_OPTIONS },
    systemPrompt: "",
    contextScope: "previous-assistant-reply",
    triggerMode: "auto",
  }
}

function createDefaultFormState(): SubagentFormState {
  return {
    draft: createDefaultDraft(),
    error: null,
    pending: false,
    confirmDelete: false,
  }
}

interface SubagentsSectionState {
  // SubagentsSettingsBranch navigation
  editing: SubagentsEditingState

  // SubagentForm state (ONE active form at a time)
  form: SubagentFormState

  // LoopRuntimePanel state
  timeoutDraft: string
  loopError: string | null

  // Actions — navigation
  setEditing: (editing: SubagentsEditingState) => void

  // Actions — form
  resetForm: (draft: SubagentInput) => void
  setFormDraft: (draft: SubagentInput) => void
  patchFormDraft: (patch: Partial<SubagentInput>) => void
  setFormError: (error: SubagentFieldError | null) => void
  setFormPending: (pending: boolean) => void
  setFormConfirmDelete: (confirmDelete: boolean) => void

  // Actions — LoopRuntimePanel
  setTimeoutDraft: (draft: string) => void
  setLoopError: (error: string | null) => void
}

export const useSubagentsSectionStore = create<SubagentsSectionState>()((set) => ({
  editing: { kind: "list" },
  form: createDefaultFormState(),
  timeoutDraft: "",
  loopError: null,

  setEditing: (editing) => set({ editing }),

  resetForm: (draft) =>
    set({
      form: {
        draft,
        error: null,
        pending: false,
        confirmDelete: false,
      },
    }),

  setFormDraft: (draft) =>
    set((state) => ({ form: { ...state.form, draft } })),

  patchFormDraft: (patch) =>
    set((state) => ({ form: { ...state.form, draft: { ...state.form.draft, ...patch } } })),

  setFormError: (error) =>
    set((state) => ({ form: { ...state.form, error } })),

  setFormPending: (pending) =>
    set((state) => ({ form: { ...state.form, pending } })),

  setFormConfirmDelete: (confirmDelete) =>
    set((state) => ({ form: { ...state.form, confirmDelete } })),

  setTimeoutDraft: (timeoutDraft) => set({ timeoutDraft }),
  setLoopError: (loopError) => set({ loopError }),
}))
