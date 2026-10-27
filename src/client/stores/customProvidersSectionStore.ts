import { create } from "zustand"
import { LIST_EDITING, type SectionEditing } from "../lib/sectionEditing"
import {
  deriveDraftId,
  emptyCustomProviderDraft,
  type CustomProviderDraft,
} from "../lib/customProviderDraft"

export interface CustomProviderEditorForm extends CustomProviderDraft {
  error: string | null
}

export type ModelRowField = "id" | "label"

function createEditorForm(draft: CustomProviderDraft): CustomProviderEditorForm {
  return { ...draft, error: null }
}

interface CustomProvidersSectionState {
  editing: SectionEditing
  menuOpen: boolean
  listError: string | null
  editorForm: CustomProviderEditorForm

  setMenuOpen: (open: boolean) => void
  setListError: (message: string | null) => void
  startEditing: (editing: SectionEditing, draft: CustomProviderDraft) => void
  discardEditor: () => void
  patchEditorForm: (patch: Partial<CustomProviderEditorForm>) => void
  setLabel: (label: string, takenIds: readonly string[]) => void
  setId: (id: string) => void
  setModelField: (index: number, field: ModelRowField, value: string) => void
  addModelRow: () => void
  removeModelRow: (index: number) => void
}

export const useCustomProvidersSectionStore = create<CustomProvidersSectionState>()((set) => ({
  editing: LIST_EDITING,
  menuOpen: false,
  listError: null,
  editorForm: createEditorForm(emptyCustomProviderDraft()),

  setMenuOpen: (menuOpen) => set({ menuOpen }),
  setListError: (listError) => set({ listError }),

  startEditing: (editing, draft) =>
    set({ editing, menuOpen: false, listError: null, editorForm: createEditorForm(draft) }),

  discardEditor: () =>
    set({ editing: LIST_EDITING, menuOpen: false, editorForm: createEditorForm(emptyCustomProviderDraft()) }),

  patchEditorForm: (patch) =>
    set((state) => ({ editorForm: { ...state.editorForm, ...patch } })),

  setLabel: (label, takenIds) =>
    set((state) => ({
      editorForm: {
        ...state.editorForm,
        label,
        id: state.editorForm.idTouched ? state.editorForm.id : deriveDraftId(label, takenIds),
      },
    })),

  setId: (id) =>
    set((state) => ({ editorForm: { ...state.editorForm, id: id.toLowerCase(), idTouched: true } })),

  setModelField: (index, field, value) =>
    set((state) => ({
      editorForm: {
        ...state.editorForm,
        models: state.editorForm.models.map((model, position) =>
          position === index ? { ...model, [field]: value } : model,
        ),
      },
    })),

  addModelRow: () =>
    set((state) => ({
      editorForm: { ...state.editorForm, models: [...state.editorForm.models, { id: "", label: "" }] },
    })),

  removeModelRow: (index) =>
    set((state) => ({
      editorForm: {
        ...state.editorForm,
        models: state.editorForm.models.filter((_, position) => position !== index),
      },
    })),
}))
