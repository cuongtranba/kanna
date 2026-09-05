
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
  ProviderId,
  RemoteSourceRef,
  SyncBinding,
  SyncConflict,
} from "../shared/boards/types"
import type { RepoBoardOwner } from "../shared/boards/sync-types"
import {
  BLOCKED_BY,
  blockerIdsOf,
  buildBlockerGraph,
  describeBlockedByCycle,
  findBlockerCycle,
  resolveBlockers,
} from "../shared/boards/dependencies"
import { findDoneColumn } from "../shared/boards/types"
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

export const DEFAULT_BOARD_PAGE_SIZE = 30

const MAX_CONFLICTS = 100

export type { BoardSummary, BoardViewSnapshot, CardDetail }

export interface BoardChange {
  boardId: string
  owner: BoardOwnerRef
}

export interface BindSyncInput extends UpsertBindingInput {
  detachFromBoardId?: string | null
}

function sourceLabel(ref: RemoteSourceRef): string {
  return ref.provider === "github-issues"
    ? `${ref.owner}/${ref.repo}`
    : `${ref.owner}/#${ref.projectNumber}`
}

export interface BoardRegistry {
  listBoards(owner: BoardOwnerRef): BoardSummary[]
  getBoard(boardId: string): Board | null
  listColumns(boardId: string): BoardColumn[]
  boardView(boardId: string, pageSize?: number): BoardViewSnapshot | null
  cardPage(query: CardPageQuery): CardPage
  cardDetail(cardId: string): CardDetail | null
  listTemplates(): BoardTemplate[]
  getTemplate(templateId: string): BoardTemplate | null
  findCardsByLink(kind: CardLinkKind, targetId: string): Card[]

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
  listBindings(boardId: string): SyncBinding[]
  repoBindingOwner(
    providerId: ProviderId,
    sourceRef: RemoteSourceRef,
    excludingBoardId: string,
  ): RepoBoardOwner | null
  bindSync(input: BindSyncInput): SyncBinding
  unbindSync(boardId: string, bindingId: string): void
  listConflicts(boardId: string): SyncConflict[]

  duplicateBoard(boardId: string, title: string): Board
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
      try {
        subscriber({ boardId, owner })
      } catch {
      }
    }
  }

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

  function definitionOf(board: Board): BoardTemplateDefinition {
    return {
      columns: store.listColumns(board.id).map((column) => ({
        title: column.title,
        semantic: column.semantic,
        colorToken: column.colorToken,
        wipLimit: column.wipLimit,
      })),
      cardFields: board.cardFields,
      mappingDefaults: [],
    }
  }

  function boardIdOfCard(cardId: string): string {
    const card = store.getCard(cardId)
    if (!card) throw new BoardStoreError("not_found", `card ${cardId} does not exist`)
    return card.boardId
  }

  function requireAcyclicBlocker(cardId: string, blockerId: string): void {
    const card = store.getCard(cardId)
    if (!card) throw new BoardStoreError("not_found", `card ${cardId} does not exist`)
    const blocker = store.getCard(blockerId)
    if (!blocker) throw new BoardStoreError("not_found", `card ${blockerId} does not exist`)
    if (blocker.boardId !== card.boardId) {
      throw new BoardStoreError("invalid_input", "a card can only wait on another card on the same board")
    }
    const graph = buildBlockerGraph(store.listCardLinksForBoard(card.boardId, BLOCKED_BY))
    const cycle = findBlockerCycle(graph, cardId, blockerId)
    if (!cycle) return
    const described = describeBlockedByCycle(cycle, (id) => store.getCard(id)?.title ?? null)
    throw new BoardStoreError("invalid_input", `that would make the work circular: ${described}`)
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

    getBoard: (boardId: string) => store.getBoard(boardId),
    listColumns: (boardId: string) => store.listColumns(boardId),

    boardView(boardId: string, pageSize = defaultPageSize): BoardViewSnapshot | null {
      const board = store.getBoard(boardId)
      if (!board) return null
      const columns = store.listColumns(boardId)
      const counts = store.countCardsByColumn(boardId)
      const cards: Record<string, Card[]> = {}
      const cursors: Record<string, string | null> = {}
      const shipped = new Set<string>()
      for (const column of columns) {
        const page = store.listCardPage({ columnId: column.id, limit: pageSize })
        cards[column.id] = page.cards
        cursors[column.id] = page.nextCursor
        for (const card of page.cards) shipped.add(card.id)
      }
      const chatLinksByCard: Record<string, string[]> = {}
      for (const link of store.listCardLinksForBoard(boardId, "chat")) {
        if (!shipped.has(link.cardId)) continue
        ;(chatLinksByCard[link.cardId] ??= []).push(link.targetId)
      }
      const bindings = store.listBindings(boardId)
      const newSince =
        bindings.reduce<number>((max, b) => (b.lastPulledAt !== null && b.lastPulledAt > max ? b.lastPulledAt : max), 0) || null
      return { board, columns, counts, cards, cursors, chatLinksByCard, newSince }
    },

    cardPage(query: CardPageQuery): CardPage {
      return store.listCardPage(query)
    },

    cardDetail(cardId: string): CardDetail | null {
      const card = store.getCard(cardId)
      if (!card) return null
      const bindings = store.listBindings(card.boardId)
      const syncLink =
        bindings.map((b) => store.getSyncLinkByCard(cardId, b.id)).find((link) => link !== null) ?? null
      const links = store.listCardLinks(cardId)
      const doneColumn = findDoneColumn(store.listColumns(card.boardId))
      return {
        card,
        links,
        comments: store.listComments(cardId),
        blockers: resolveBlockers(blockerIdsOf(links), (id) => store.getCard(id), doneColumn?.id ?? null),
        externalRef: syncLink?.externalId ?? null,
      }
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
      mutate(
        () => boardIdOfCard(cardId),
        () => {
          if (kind === BLOCKED_BY) requireAcyclicBlocker(cardId, targetId)
          return store.addCardLink(cardId, kind, targetId)
        },
      ),
    removeCardLink: (cardId, kind, targetId) =>
      mutate(() => boardIdOfCard(cardId), () => store.removeCardLink(cardId, kind, targetId)),
    addComment: (cardId, author, body) =>
      mutate(() => boardIdOfCard(cardId), () => store.addComment(cardId, author, body)),

    listBindings: (boardId) => store.listBindings(boardId),
    listConflicts: (boardId) => store.listConflicts(boardId, MAX_CONFLICTS),

    repoBindingOwner(
      providerId: ProviderId,
      sourceRef: RemoteSourceRef,
      excludingBoardId: string,
    ): RepoBoardOwner | null {
      const foreign = store
        .findBindingsBySource(providerId, sourceRef)
        .find((binding) => binding.boardId !== excludingBoardId)
      if (!foreign) return null
      const board = store.getBoard(foreign.boardId)
      if (!board) return null
      const counts = store.countCardsByColumn(board.id)
      return {
        boardId: board.id,
        boardTitle: board.title,
        cardCount: Object.values(counts).reduce((total, count) => total + count, 0),
      }
    },

    bindSync(input: BindSyncInput): SyncBinding {
      const { detachFromBoardId, ...binding } = input
      return mutate(
        () => binding.boardId,
        () => {
          const foreign = store
            .findBindingsBySource(binding.providerId, binding.sourceRef)
            .filter((existing) => existing.boardId !== binding.boardId)

          if (foreign.length > 0) {
            const holder = foreign[0]
            if (!detachFromBoardId || !foreign.some((b) => b.boardId === detachFromBoardId)) {
              throw new BoardStoreError(
                "conflict",
                `${sourceLabel(binding.sourceRef)} is already synced by board ${holder?.boardId}; ` +
                  "connecting it here detaches it from that board — pass detachFromBoardId to confirm",
              )
            }
            for (const stale of foreign) store.deleteBinding(stale.id)
          }

          return store.upsertBinding(binding)
        },
      )
    },

    unbindSync(boardId: string, bindingId: string): void {
      mutate(
        () => boardId,
        () => {
          const owned = store.listBindings(boardId).some((b) => b.id === bindingId)
          if (!owned) {
            throw new BoardStoreError("not_found", `binding ${bindingId} is not on this board`)
          }
          store.deleteBinding(bindingId)
        },
      )
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
