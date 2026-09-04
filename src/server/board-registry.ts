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
  ProviderId,
  RemoteSourceRef,
  SyncBinding,
  SyncConflict,
} from "../shared/boards/types"
import type { RepoBoardOwner } from "../shared/boards/sync-types"
import { BLOCKED_BY, buildBlockerGraph, describeBlockedByCycle, findBlockerCycle } from "../shared/boards/dependencies"
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

export interface BindSyncInput extends UpsertBindingInput {
  /**
   * The board this repo is being taken FROM, when another board holds it.
   *
   * Required only for a move, and checked against the live owner rather than
   * trusted — so a screen whose view of the world went stale is refused instead
   * of silently detaching a board the user never saw.
   */
  detachFromBoardId?: string | null
}

/** `owner/repo` for a refusal a human has to act on. */
function sourceLabel(ref: RemoteSourceRef): string {
  return ref.provider === "github-issues"
    ? `${ref.owner}/${ref.repo}`
    : `${ref.owner}/#${ref.projectNumber}`
}

export interface BoardRegistry {
  // Reads
  listBoards(owner: BoardOwnerRef): BoardSummary[]
  getBoard(boardId: string): Board | null
  listColumns(boardId: string): BoardColumn[]
  boardView(boardId: string, pageSize?: number): BoardViewSnapshot | null
  cardPage(query: CardPageQuery): CardPage
  cardDetail(cardId: string): CardDetail | null
  /**
   * One card, archived ones included — a blocker that was archived is still the
   * row that explains why a dependency cleared.
   */
  getCard(cardId: string): Card | null
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
  listBindings(boardId: string): SyncBinding[]
  /**
   * The board already holding this repo, if it is not `excludingBoardId`.
   *
   * Read-only, and the connect screen's whole basis for asking before moving:
   * a repo binds to exactly one board, so a second board wanting it is a MOVE.
   */
  repoBindingOwner(
    providerId: ProviderId,
    sourceRef: RemoteSourceRef,
    excludingBoardId: string,
  ): RepoBoardOwner | null
  /**
   * Connect a board to a tracker. Broadcasts: the board's sync state is visible on it.
   *
   * A repo binds to exactly ONE board. `sync_link_external_idx` is unique per
   * `(binding_id, external_id)` — per BINDING, not per issue — so two bindings
   * on the same repo each hold every issue as a SEPARATE card, with two sync
   * links and two outbox entries, and the two boards then race each other
   * last-writer-wins onto the real tracker. Binding a repo another board holds
   * is therefore refused unless `detachFromBoardId` names that board, which
   * makes the move explicit and auditable rather than an accident of clicking
   * Connect twice.
   */
  bindSync(input: BindSyncInput): SyncBinding
  /**
   * Disconnect one repo. The cards it created stay; only the link is cut.
   *
   * Takes the board id as well as the binding id and refuses a binding that
   * belongs to another board — the same discipline the MCP board tools use, so
   * a guessed id cannot reach across boards.
   */
  unbindSync(boardId: string, bindingId: string): void
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

  /**
   * Refuse a dependency edge that could not be diagnosed once stored
   * (adr-20260904-cross-project-orchestration, D2).
   *
   * This sits in the generic `addCardLink` rather than in a method of its own
   * because every production write to a card link already comes through this
   * registry — start-work, worktree cleanup, the agent coordinator — and none
   * reaches {@link BoardStore} directly. Validating the one arm means no
   * caller, present or future, can author a `blocked_by` edge that skipped the
   * check.
   *
   * Cross-board is refused for the same reason a cycle is: the start-work gate
   * resolves blockers through the card's OWN board, so an edge pointing off it
   * would read as permanently unmet and wedge the card with nothing on screen
   * to explain why.
   */
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
      // Scoped to the page, not the board: a 5000-card board ships one page and
      // must not pay for the links of the 4970 cards it left behind.
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
      return {
        card,
        links: store.listCardLinks(cardId),
        comments: store.listComments(cardId),
        externalRef: syncLink?.externalId ?? null,
      }
    },

    getCard: (cardId: string) => store.getCard(cardId),
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
            // Naming the board is what makes this a move the user chose rather
            // than one they discovered afterwards, and re-checking it here
            // closes the window between the screen reading the owner and the
            // user confirming.
            const holder = foreign[0]
            if (!detachFromBoardId || !foreign.some((b) => b.boardId === detachFromBoardId)) {
              throw new BoardStoreError(
                "conflict",
                `${sourceLabel(binding.sourceRef)} is already synced by board ${holder?.boardId}; ` +
                  "connecting it here detaches it from that board — pass detachFromBoardId to confirm",
              )
            }
            // Deleting the binding cascades its sync links and outbox; the
            // other board's CARDS stay, because unbinding is not deleting the
            // work (see unbindSync).
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
