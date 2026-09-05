import { create } from "zustand"
import type { CardDetailView } from "../../../shared/boards/start-work"

interface CardDrawerState {
  detail: CardDetailView | null
  error: string | null
  draft: string
  editingFieldId: string | null
  fieldDraft: string
  startingWork: boolean
  startWorkNote: string | null
  setDetail(detail: CardDetailView | null): void
  setError(error: string | null): void
  setDraft(draft: string): void
  beginFieldEdit(fieldId: string, initial: string): void
  setFieldDraft(fieldDraft: string): void
  cancelFieldEdit(): void
  takeFieldDraft(fieldId: string): string | null
  resolvingCleanup: boolean
  beginStartWork(): void
  endStartWork(note: string | null): void
  beginCleanup(): void
  endCleanup(): void
  reset(): void
}

export const useCardDrawerStore = create<CardDrawerState>()((set, get) => ({
  detail: null,
  error: null,
  draft: "",
  editingFieldId: null,
  fieldDraft: "",
  startingWork: false,
  startWorkNote: null,
  resolvingCleanup: false,
  setDetail: (detail) => set({ detail, error: null }),
  setError: (error) => set({ error }),
  setDraft: (draft) => set({ draft }),
  beginFieldEdit: (fieldId, initial) => set({ editingFieldId: fieldId, fieldDraft: initial, error: null }),
  setFieldDraft: (fieldDraft) => set({ fieldDraft }),
  cancelFieldEdit: () => set({ editingFieldId: null, fieldDraft: "" }),
  takeFieldDraft: (fieldId) => {
    const { editingFieldId, fieldDraft } = get()
    if (editingFieldId !== fieldId) return null
    set({ editingFieldId: null, fieldDraft: "" })
    return fieldDraft
  },
  beginStartWork: () => set({ startingWork: true, error: null, startWorkNote: null }),
  endStartWork: (note) => set({ startingWork: false, startWorkNote: note }),
  beginCleanup: () => set({ resolvingCleanup: true, error: null }),
  endCleanup: () => set({ resolvingCleanup: false }),
  reset: () =>
    set({
      detail: null,
      error: null,
      draft: "",
      editingFieldId: null,
      fieldDraft: "",
      startingWork: false,
      startWorkNote: null,
      resolvingCleanup: false,
    }),
}))
