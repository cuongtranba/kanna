import { create } from "zustand"
import type { CardDetail } from "../../../shared/boards/types"

/**
 * Card drawer state.
 *
 * One drawer is open at a time — it is anchored to the pane, not to a card — so
 * a single detail slot is enough and cannot drift from a keyed map.
 */
interface CardDrawerState {
  detail: CardDetail | null
  error: string | null
  /** The comment being typed. */
  draft: string
  setDetail(detail: CardDetail | null): void
  setError(error: string | null): void
  setDraft(draft: string): void
  /** Clear before loading another card, so the previous one never shows through. */
  reset(): void
}

export const useCardDrawerStore = create<CardDrawerState>()((set) => ({
  detail: null,
  error: null,
  draft: "",
  setDetail: (detail) => set({ detail, error: null }),
  setError: (error) => set({ error }),
  setDraft: (draft) => set({ draft }),
  reset: () => set({ detail: null, error: null, draft: "" }),
}))
