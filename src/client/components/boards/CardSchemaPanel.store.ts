import { create } from "zustand"
import { isFieldKind, type FieldDef, type FieldKind } from "../../../shared/boards/types"
import {
  addField,
  addOption,
  moveField,
  removeField,
  removeOption,
  renameField,
  renameOption,
  setOptionColor,
  toggleRequired,
} from "../../lib/boards/cardSchemaDraft"

interface CardSchemaState {
  draft: readonly FieldDef[]
  newLabel: string
  newKind: FieldKind
  optionDraftByField: Readonly<Record<string, string>>
  pendingRemovalFieldId: string | null
  saving: boolean
  error: string | null
  open(fields: readonly FieldDef[]): void
  setNewLabel(newLabel: string): void
  setNewKind(raw: string): void
  addField(): void
  renameField(fieldId: string, label: string): void
  moveField(fieldId: string, delta: number): void
  toggleRequired(fieldId: string): void
  askRemoveField(fieldId: string): void
  cancelRemoveField(): void
  removeField(fieldId: string): void
  setOptionDraft(fieldId: string, label: string): void
  addOption(fieldId: string): void
  renameOption(fieldId: string, optionId: string, label: string): void
  removeOption(fieldId: string, optionId: string): void
  setOptionColor(fieldId: string, optionId: string, raw: string): void
  beginSave(): void
  endSave(error: string | null): void
}

const EMPTY_DRAFT: readonly FieldDef[] = []
const NO_OPTION_DRAFTS: Readonly<Record<string, string>> = {}

export const useCardSchemaStore = create<CardSchemaState>()((set) => ({
  draft: EMPTY_DRAFT,
  newLabel: "",
  newKind: "text",
  optionDraftByField: NO_OPTION_DRAFTS,
  pendingRemovalFieldId: null,
  saving: false,
  error: null,

  open: (fields) =>
    set({
      draft: fields,
      newLabel: "",
      newKind: "text",
      optionDraftByField: NO_OPTION_DRAFTS,
      pendingRemovalFieldId: null,
      saving: false,
      error: null,
    }),

  setNewLabel: (newLabel) => set({ newLabel }),
  setNewKind: (raw) => set({ newKind: isFieldKind(raw) ? raw : "text" }),

  addField: () =>
    set((state) => ({ draft: addField(state.draft, state.newLabel, state.newKind), newLabel: "" })),

  renameField: (fieldId, label) => set((state) => ({ draft: renameField(state.draft, fieldId, label) })),
  moveField: (fieldId, delta) => set((state) => ({ draft: moveField(state.draft, fieldId, delta) })),
  toggleRequired: (fieldId) => set((state) => ({ draft: toggleRequired(state.draft, fieldId) })),

  askRemoveField: (pendingRemovalFieldId) => set({ pendingRemovalFieldId }),
  cancelRemoveField: () => set({ pendingRemovalFieldId: null }),
  removeField: (fieldId) =>
    set((state) => ({ draft: removeField(state.draft, fieldId), pendingRemovalFieldId: null })),

  setOptionDraft: (fieldId, label) =>
    set((state) => ({ optionDraftByField: { ...state.optionDraftByField, [fieldId]: label } })),
  addOption: (fieldId) =>
    set((state) => ({
      draft: addOption(state.draft, fieldId, state.optionDraftByField[fieldId] ?? ""),
      optionDraftByField: { ...state.optionDraftByField, [fieldId]: "" },
    })),
  renameOption: (fieldId, optionId, label) =>
    set((state) => ({ draft: renameOption(state.draft, fieldId, optionId, label) })),
  removeOption: (fieldId, optionId) =>
    set((state) => ({ draft: removeOption(state.draft, fieldId, optionId) })),
  setOptionColor: (fieldId, optionId, raw) =>
    set((state) => ({ draft: setOptionColor(state.draft, fieldId, optionId, raw) })),

  beginSave: () => set({ saving: true, error: null }),
  endSave: (error) => set({ saving: false, error }),
}))
