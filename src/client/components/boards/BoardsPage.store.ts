import { create } from "zustand"
import type { BoardTemplate } from "../../../shared/boards/types"

/** Module-level empty so the selector returns a stable reference. */
const EMPTY_TEMPLATES: BoardTemplate[] = []

/**
 * Transient UI state for the Boards page.
 *
 * These live in a store rather than in `useState` closures because the repo
 * bans state TRANSITIONS inside JSX attributes (`no-jsx-inline-state-logic`):
 * each transition below is a named action, so a handler in the component is
 * one call and nothing more.
 */
interface BoardsPageState {
  /** Built-in + user templates, fetched once per page mount. */
  templates: BoardTemplate[]
  /** The board whose row menu is open; only one at a time. */
  openMenuId: string | null
  /** The template picker is open by explicit request (it also opens when a project has no boards). */
  picking: boolean
  /** The board whose title is being edited inline, if any. */
  renamingId: string | null
  /** Last command failure, shown on the page rather than as a toast. */
  error: string | null
  setTemplates(templates: BoardTemplate[]): void
  openMenu(boardId: string): void
  closeMenu(): void
  openPicker(): void
  closePicker(): void
  startRename(boardId: string): void
  stopRename(): void
  setError(error: string | null): void
}

export const useBoardsPageStore = create<BoardsPageState>()((set) => ({
  templates: EMPTY_TEMPLATES,
  openMenuId: null,
  picking: false,
  renamingId: null,
  error: null,
  // The value crosses the wire, and the loader's own catch promises that a
  // missing template list will not blank the page. A non-array would break that
  // promise by crashing the picker instead, so it is treated as none.
  setTemplates: (templates) => set({ templates: Array.isArray(templates) ? templates : [] }),
  openMenu: (openMenuId) => set({ openMenuId }),
  closeMenu: () => set({ openMenuId: null }),
  openPicker: () => set({ picking: true, error: null }),
  closePicker: () => set({ picking: false }),
  // Opening a rename closes the picker and any row menu: two edit affordances at once is a
  // state the page has no layout for.
  startRename: (renamingId) => set({ renamingId, picking: false, openMenuId: null }),
  stopRename: () => set({ renamingId: null }),
  setError: (error) => set({ error }),
}))

export function selectTemplates(state: BoardsPageState): BoardTemplate[] {
  return state.templates
}
