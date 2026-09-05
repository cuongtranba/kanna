import { create } from "zustand"
import type { BoardSummary, BoardViewSnapshot } from "../../shared/boards/types"

const EMPTY_BOARDS: BoardSummary[] = []

export const BOARD_PAGE_STEP = 30

export interface BoardsState {
  boardsByOwner: Record<string, BoardSummary[]>
  viewByBoard: Record<string, BoardViewSnapshot | null>
  pageSizeByBoard: Record<string, number>
  setBoards(ownerKey: string, boards: BoardSummary[]): void
  setBoardView(boardId: string, view: BoardViewSnapshot | null): void
  growPage(boardId: string): void
  clearBoardView(boardId: string): void
}

export function ownerKey(ownerKind: string, ownerId: string): string {
  return `${ownerKind}:${ownerId}`
}

export const useBoardsStore = create<BoardsState>()((set) => ({
  boardsByOwner: {},
  viewByBoard: {},
  pageSizeByBoard: {},
  setBoards: (key, boards) => set((state) => ({ boardsByOwner: { ...state.boardsByOwner, [key]: boards } })),
  setBoardView: (boardId, view) => set((state) => ({ viewByBoard: { ...state.viewByBoard, [boardId]: view } })),
  growPage: (boardId) =>
    set((state) => {
      const view = state.viewByBoard[boardId]
      if (view && !Object.values(view.cursors).some((cursor) => cursor !== null)) return state
      const current = state.pageSizeByBoard[boardId] ?? BOARD_PAGE_STEP
      return { pageSizeByBoard: { ...state.pageSizeByBoard, [boardId]: current + BOARD_PAGE_STEP } }
    }),
  clearBoardView: (boardId) =>
    set((state) => {
      if (!(boardId in state.viewByBoard)) return state
      const next = { ...state.viewByBoard }
      delete next[boardId]
      const sizes = { ...state.pageSizeByBoard }
      delete sizes[boardId]
      return { viewByBoard: next, pageSizeByBoard: sizes }
    }),
}))

export function selectBoards(key: string) {
  return (state: BoardsState): BoardSummary[] => state.boardsByOwner[key] ?? EMPTY_BOARDS
}

export function selectBoardView(boardId: string) {
  return (state: BoardsState): BoardViewSnapshot | null => state.viewByBoard[boardId] ?? null
}

export function selectBoardPageSize(boardId: string) {
  return (state: BoardsState): number => state.pageSizeByBoard[boardId] ?? BOARD_PAGE_STEP
}

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
