import { create } from "zustand"
import type { CardDetailView } from "../../../shared/boards/start-work"

/**
 * Card drawer state.
 *
 * One drawer is open at a time — it is anchored to the pane, not to a card — so
 * a single detail slot is enough and cannot drift from a keyed map.
 */
interface CardDrawerState {
  detail: CardDetailView | null
  error: string | null
  /** The comment being typed. */
  draft: string
  /**
   * The one field currently open for editing, and what has been typed into it.
   *
   * One at a time by design: a drawer full of live inputs would have to decide
   * what an unsaved one means when the card reloads. Every kind is drafted as
   * text — a list as its comma-separated line, a date as `YYYY-MM-DD` — so this
   * pair covers the whole schema without a per-kind slot.
   */
  editingFieldId: string | null
  fieldDraft: string
  /** True while the worktree is being created and the chat spawned. */
  startingWork: boolean
  /** What the button did, in one line, once it is done. */
  startWorkNote: string | null
  setDetail(detail: CardDetailView | null): void
  setError(error: string | null): void
  setDraft(draft: string): void
  beginFieldEdit(fieldId: string, initial: string): void
  setFieldDraft(fieldDraft: string): void
  /** Esc: the draft is dropped and the value stands. */
  cancelFieldEdit(): void
  /**
   * Close the edit and hand back what was typed — or null if it is no longer
   * open, which is what Esc leaves behind.
   *
   * One action rather than a read plus a clear because both callers race:
   * pressing Esc removes the input, and the blur that follows would otherwise
   * commit the draft the Esc had just discarded.
   */
  takeFieldDraft(fieldId: string): string | null
  /** True while a merge / discard / leave is in flight. */
  resolvingCleanup: boolean
  beginStartWork(): void
  /** Settle the button whether the attempt worked or not; `note` is null on failure. */
  endStartWork(note: string | null): void
  beginCleanup(): void
  endCleanup(): void
  /** Clear before loading another card, so the previous one never shows through. */
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
