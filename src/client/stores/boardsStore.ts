import { create } from "zustand"
import type { BoardSummary, BoardViewSnapshot } from "../../shared/boards/types"

/**
 * Module-level empties so a selector that misses returns the SAME reference
 * every render. An inline `?? []` produces a fresh array each call and drives
 * React error #185 — see the render-loop rules in CLAUDE.md.
 */
const EMPTY_BOARDS: BoardSummary[] = []

export interface BoardsState {
  /** Board lists keyed by `${ownerKind}:${ownerId}`. */
  boardsByOwner: Record<string, BoardSummary[]>
  /** Full board views keyed by boardId; null once the board is gone. */
  viewByBoard: Record<string, BoardViewSnapshot | null>
  setBoards(ownerKey: string, boards: BoardSummary[]): void
  setBoardView(boardId: string, view: BoardViewSnapshot | null): void
  clearBoardView(boardId: string): void
}

export function ownerKey(ownerKind: string, ownerId: string): string {
  return `${ownerKind}:${ownerId}`
}

export const useBoardsStore = create<BoardsState>()((set) => ({
  boardsByOwner: {},
  viewByBoard: {},
  setBoards: (key, boards) => set((state) => ({ boardsByOwner: { ...state.boardsByOwner, [key]: boards } })),
  setBoardView: (boardId, view) => set((state) => ({ viewByBoard: { ...state.viewByBoard, [boardId]: view } })),
  clearBoardView: (boardId) =>
    set((state) => {
      if (!(boardId in state.viewByBoard)) return state
      const next = { ...state.viewByBoard }
      delete next[boardId]
      return { viewByBoard: next }
    }),
}))

export function selectBoards(key: string) {
  return (state: BoardsState): BoardSummary[] => state.boardsByOwner[key] ?? EMPTY_BOARDS
}

export function selectBoardView(boardId: string) {
  return (state: BoardsState): BoardViewSnapshot | null => state.viewByBoard[boardId] ?? null
}

/** Titles by boardId across every owner, for pane tab labels. */
export function selectBoardTitles(state: BoardsState): Record<string, string> {
  const titles: Record<string, string> = {}
  for (const boards of Object.values(state.boardsByOwner)) {
    for (const board of boards) titles[board.id] = board.title
  }
  for (const [boardId, view] of Object.entries(state.viewByBoard)) {
    if (view) titles[boardId] = view.board.title
  }
  return titles
}
