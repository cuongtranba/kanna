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
  /** True while the worktree is being created and the chat spawned. */
  startingWork: boolean
  /** What the button did, in one line, once it is done. */
  startWorkNote: string | null
  setDetail(detail: CardDetailView | null): void
  setError(error: string | null): void
  setDraft(draft: string): void
  beginStartWork(): void
  /** Settle the button whether the attempt worked or not; `note` is null on failure. */
  endStartWork(note: string | null): void
  /** Clear before loading another card, so the previous one never shows through. */
  reset(): void
}

export const useCardDrawerStore = create<CardDrawerState>()((set) => ({
  detail: null,
  error: null,
  draft: "",
  startingWork: false,
  startWorkNote: null,
  setDetail: (detail) => set({ detail, error: null }),
  setError: (error) => set({ error }),
  setDraft: (draft) => set({ draft }),
  beginStartWork: () => set({ startingWork: true, error: null, startWorkNote: null }),
  endStartWork: (note) => set({ startingWork: false, startWorkNote: note }),
  reset: () => set({ detail: null, error: null, draft: "", startingWork: false, startWorkNote: null }),
}))
