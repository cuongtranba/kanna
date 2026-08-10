/**
 * Read-model and change notification for boards.
 *
 * Every board mutation in Kanna goes through this facade rather than through
 * {@link BoardStore} directly, and every mutation here runs inside
 * {@link mutate}, which notifies subscribers after the write commits. That is
 * structural, not a convention: a write that forgets to broadcast leaves the
 * UI showing stale columns until the next reload, and it is invisible in
 * review. `board-registry.test.ts` enumerates the mutating surface and asserts
 * each one emits.
 *
 * No IO of its own — the store is injected, so this module stays inside the
 * side-effect seal.
 */

import type {
  Board,
  BoardColumn,
  BoardTemplate,
  BoardTemplateDefinition,
  BoardSummary,
  BoardViewSnapshot,
  Card,
  CardActor,
  CardComment,
  CardDetail,
  CardLink,
  CardLinkKind,
  SyncBinding,
  SyncConflict,
} from "../shared/boards/types"
import {
  BoardStoreError,
  type BoardOwnerRef,
  type BoardStore,
  type CardPage,
  type CardPageQuery,
  type CreateBoardInput,
  type CreateCardInput,
  type CreateColumnInput,
  type CreateTemplateInput,
  type MoveCardInput,
  type MoveColumnInput,
  type UpdateBoardPatch,
  type UpdateCardPatch,
  type UpdateColumnPatch,
  type UpsertBindingInput,
} from "./board-store"

/** How many cards each column ships in the initial board snapshot. */
export const DEFAULT_BOARD_PAGE_SIZE = 30

/** Conflicts are a review queue, not a log; the newest are the actionable ones. */
const MAX_CONFLICTS = 100

export type { BoardSummary, BoardViewSnapshot, CardDetail }

export interface BoardChange {
  boardId: string
  owner: BoardOwnerRef
}

export interface BoardRegistry {
  // Reads
  listBoards(owner: BoardOwnerRef): BoardSummary[]
  boardView(boardId: string, pageSize?: number): BoardViewSnapshot | null
  cardPage(query: CardPageQuery): CardPage
  cardDetail(cardId: string): CardDetail | null
  listTemplates(): BoardTemplate[]
  getTemplate(templateId: string): BoardTemplate | null
  findCardsByLink(kind: CardLinkKind, targetId: string): Card[]

  // Writes — each notifies subscribers
  createBoard(input: CreateBoardInput): Board
  updateBoard(boardId: string, patch: UpdateBoardPatch): Board
  archiveBoard(boardId: string): void
  createColumn(input: CreateColumnInput): BoardColumn
  updateColumn(columnId: string, patch: UpdateColumnPatch): BoardColumn
  moveColumn(input: MoveColumnInput): BoardColumn
  deleteColumn(columnId: string): void
  createCard(input: CreateCardInput): Card
  updateCard(cardId: string, patch: UpdateCardPatch, actor: CardActor): Card
  moveCard(input: MoveCardInput): Card
  archiveCard(cardId: string, actor: CardActor): void
  addCardLink(cardId: string, kind: CardLinkKind, targetId: string): CardLink
  removeCardLink(cardId: string, kind: CardLinkKind, targetId: string): void
  addComment(cardId: string, author: CardActor, body: string): CardComment
  createTemplate(input: CreateTemplateInput): BoardTemplate
  deleteTemplate(templateId: string): void
  /**
   * Copy a board's STRUCTURE — columns and card schema — into a new board.
   *
   * Deliberately not its cards: a board mirroring a 300-issue tracker would
   * silently clone 300 rows, and the UI labels this "Duplicate structure" so
   * the two can never disagree.
   */
  // Sync
  getBinding(boardId: string): SyncBinding | null
  /** Connect a board to a tracker. Broadcasts: the board's sync state is visible on it. */
  bindSync(input: UpsertBindingInput): SyncBinding
  listConflicts(boardId: string): SyncConflict[]

  duplicateBoard(boardId: string, title: string): Board
  /** Turn a board's columns + card schema into a reusable template. */
  saveBoardAsTemplate(boardId: string, name: string, description?: string | null): BoardTemplate

  subscribe(cb: (change: BoardChange) => void): () => void
  close(): void
}

export interface CreateBoardRegistryOptions {
  store: BoardStore
  pageSize?: number
}

export function createBoardRegistry(options: CreateBoardRegistryOptions): BoardRegistry {
  const { store } = options
  const defaultPageSize = options.pageSize ?? DEFAULT_BOARD_PAGE_SIZE
  const subscribers = new Set<(change: BoardChange) => void>()

  function ownerOf(boardId: string): BoardOwnerRef {
    const board = store.getBoard(boardId)
    if (!board) throw new BoardStoreError("not_found", `board ${boardId} does not exist`)
    return { kind: board.ownerKind, id: board.ownerId }
  }

  function notify(boardId: string, owner: BoardOwnerRef): void {
    for (const subscriber of subscribers) {
      // One bad subscriber must not abort the rest of the fan-out, nor the
      // write that triggered it — the write has already committed.
      try {
        subscriber({ boardId, owner })
      } catch {
        // Subscriber failures are its own problem.
      }
    }
  }

  /**
   * Run a write and broadcast it. `resolveBoardId` runs BEFORE the write when
   * the board id is only derivable from a row the write is about to remove.
   */
  function mutate<T>(resolveBoardId: () => string, write: () => T): T {
    const boardId = resolveBoardId()
    const owner = ownerOf(boardId)
    const result = write()
    notify(boardId, owner)
    return result
  }

  function boardIdOfColumn(columnId: string): string {
    const column = store.getColumn(columnId)
    if (!column) throw new BoardStoreError("not_found", `column ${columnId} does not exist`)
    return column.boardId
  }

  /** A board's reusable shape: its columns and its card schema. */
  function definitionOf(board: Board): BoardTemplateDefinition {
    return {
      columns: store.listColumns(board.id).map((column) => ({
        title: column.title,
        semantic: column.semantic,
        colorToken: column.colorToken,
        wipLimit: column.wipLimit,
      })),
      cardFields: board.cardFields,
      // Sync mappings belong to a binding, not to the shape being copied.
      mappingDefaults: [],
    }
  }

  function boardIdOfCard(cardId: string): string {
    const card = store.getCard(cardId)
    if (!card) throw new BoardStoreError("not_found", `card ${cardId} does not exist`)
    return card.boardId
  }

  return {
    listBoards(owner: BoardOwnerRef): BoardSummary[] {
      return store.listBoards(owner).map((board) => {
        const counts = store.countCardsByColumn(board.id)
        const cardCount = Object.values(counts).reduce((total, count) => total + count, 0)
        return {
          id: board.id,
          title: board.title,
          description: board.description,
          columnCount: Object.keys(counts).length,
          cardCount,
          updatedAt: board.updatedAt,
        }
      })
    },

    boardView(boardId: string, pageSize = defaultPageSize): BoardViewSnapshot | null {
      const board = store.getBoard(boardId)
      if (!board) return null
      const columns = store.listColumns(boardId)
      const counts = store.countCardsByColumn(boardId)
      const cards: Record<string, Card[]> = {}
      const cursors: Record<string, string | null> = {}
      for (const column of columns) {
        const page = store.listCardPage({ columnId: column.id, limit: pageSize })
        cards[column.id] = page.cards
        cursors[column.id] = page.nextCursor
      }
      return { board, columns, counts, cards, cursors }
    },

    cardPage(query: CardPageQuery): CardPage {
      return store.listCardPage(query)
    },

    cardDetail(cardId: string): CardDetail | null {
      const card = store.getCard(cardId)
      if (!card) return null
      return { card, links: store.listCardLinks(cardId), comments: store.listComments(cardId) }
    },

    listTemplates: () => store.listTemplates(),
    getTemplate: (templateId: string) => store.getTemplate(templateId),
    findCardsByLink: (kind: CardLinkKind, targetId: string) => store.findCardsByLink(kind, targetId),

    createBoard(input: CreateBoardInput): Board {
      const board = store.createBoard(input)
      notify(board.id, input.owner)
      return board
    },

    updateBoard: (boardId, patch) => mutate(() => boardId, () => store.updateBoard(boardId, patch)),
    archiveBoard: (boardId) => mutate(() => boardId, () => store.archiveBoard(boardId)),

    createColumn: (input) => mutate(() => input.boardId, () => store.createColumn(input)),
    updateColumn: (columnId, patch) =>
      mutate(() => boardIdOfColumn(columnId), () => store.updateColumn(columnId, patch)),
    moveColumn: (input) => mutate(() => boardIdOfColumn(input.columnId), () => store.moveColumn(input)),
    deleteColumn: (columnId) => mutate(() => boardIdOfColumn(columnId), () => store.deleteColumn(columnId)),

    createCard: (input) => mutate(() => input.boardId, () => store.createCard(input)),
    updateCard: (cardId, patch, actor) =>
      mutate(() => boardIdOfCard(cardId), () => store.updateCard(cardId, patch, actor)),
    moveCard: (input) => mutate(() => boardIdOfCard(input.cardId), () => store.moveCard(input)),
    archiveCard: (cardId, actor) => mutate(() => boardIdOfCard(cardId), () => store.archiveCard(cardId, actor)),

    addCardLink: (cardId, kind, targetId) =>
      mutate(() => boardIdOfCard(cardId), () => store.addCardLink(cardId, kind, targetId)),
    removeCardLink: (cardId, kind, targetId) =>
      mutate(() => boardIdOfCard(cardId), () => store.removeCardLink(cardId, kind, targetId)),
    addComment: (cardId, author, body) =>
      mutate(() => boardIdOfCard(cardId), () => store.addComment(cardId, author, body)),

    getBinding: (boardId) => store.getBinding(boardId),
    listConflicts: (boardId) => store.listConflicts(boardId, MAX_CONFLICTS),

    bindSync(input: UpsertBindingInput): SyncBinding {
      return mutate(() => input.boardId, () => store.upsertBinding(input))
    },

    createTemplate: (input) => store.createTemplate(input),
    deleteTemplate: (templateId) => store.deleteTemplate(templateId),

    duplicateBoard(boardId: string, title: string): Board {
      const source = store.getBoard(boardId)
      if (!source) throw new BoardStoreError("not_found", `board ${boardId} does not exist`)
      const board = store.createBoard({
        owner: { kind: source.ownerKind, id: source.ownerId },
        title,
        description: source.description,
        definition: definitionOf(source),
        templateId: source.templateId,
      })
      notify(board.id, { kind: board.ownerKind, id: board.ownerId })
      return board
    },

    saveBoardAsTemplate(boardId: string, name: string, description?: string | null): BoardTemplate {
      const source = store.getBoard(boardId)
      if (!source) throw new BoardStoreError("not_found", `board ${boardId} does not exist`)
      return store.createTemplate({ name, description: description ?? source.description, definition: definitionOf(source) })
    },

    subscribe(cb: (change: BoardChange) => void): () => void {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },

    close(): void {
      subscribers.clear()
      store.close()
    },
  }
}
