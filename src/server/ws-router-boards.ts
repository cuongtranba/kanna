/**
 * ws-router-boards.ts
 *
 * WS command handlers for kanban boards.
 *
 * Every write here goes through {@link BoardRegistry}, never the store, so the
 * matching snapshot push happens automatically (see `board-registry.ts`).
 * Handlers only translate the wire command into a registry call.
 *
 * All commands originating on this path are attributed to the user. Agent-origin
 * writes arrive through the kanna-mcp board tools instead and carry their chat
 * id, because attribution decides whether a change may be pushed to a remote
 * tracker.
 */

import { PROTOCOL_VERSION } from "../shared/types"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import type { BoardColumn, CardActor } from "../shared/boards/types"
import { columnForRemoteState } from "../shared/boards/types"
import { decodeContentForFields, decodeFieldDefsForWrite } from "../shared/boards/decode"
import type { BoardSyncStatus, SyncColumnRef } from "../shared/boards/sync-types"
import { BoardStoreError, type UpdateBoardPatch, type UpdateCardPatch } from "./board-store"
import type { BoardRegistry } from "./board-registry"
import type { BoardSync } from "./board-sync"
import type { CardDetailView, StartWorkResult, StartWorkView } from "../shared/boards/start-work"
import type { CleanupDecision, WorktreeCleanupView } from "../shared/boards/worktree-cleanup"
import type { WorktreeCleanupOutcome } from "./board-worktree-cleanup"
import { errorMessage } from "../shared/errors"

const USER: CardActor = { kind: "user" }

export interface BoardCommandDeps {
  boardRegistry: BoardRegistry | undefined
  /** Absent when no sync provider is configured; sync commands then refuse. */
  boardSync: BoardSync | undefined
  /**
   * Card → worktree → chat. Injected rather than built here because it reaches
   * git and the chat store, neither of which this module may import.
   */
  startWork: ((cardId: string) => Promise<StartWorkResult>) | undefined
  /** The same resolver, read-only — what the drawer's button label is derived from. */
  startWorkView: ((cardId: string) => Promise<StartWorkView>) | undefined
  /** The question a card asks on reaching `done`, and the answer to it. */
  cleanupView: ((cardId: string) => Promise<WorktreeCleanupView | null>) | undefined
  resolveCleanup: ((cardId: string, decision: CleanupDecision) => Promise<WorktreeCleanupOutcome>) | undefined
  /** `owner/repo` from the board project's `origin`, offered as a default when binding. */
  suggestSyncRepo: ((boardId: string) => Promise<{ owner: string; repo: string } | null>) | undefined
  send: (envelope: ServerEnvelope) => void
}

const BOARD_COMMAND_TYPES = new Set<string>([
  "board.create",
  "board.archive",
  "board.update",
  "board.duplicate",
  "board.saveAsTemplate",
  "board.column.create",
  "board.column.update",
  "board.column.move",
  "board.column.delete",
  "board.card.create",
  "board.card.move",
  "board.card.archive",
  "board.card.detail",
  "board.card.comment",
  "board.card.update",
  "board.card.startWork",
  "board.card.resolveWorktree",
  "board.cards.page",
  "board.templates.list",
  "board.sync.bind",
  "board.sync.pull",
  "board.sync.push",
  "board.sync.status",
])

export function isBoardCommand(command: ClientCommand): boolean {
  return BOARD_COMMAND_TYPES.has(command.type)
}

/**
 * Handle one board command.
 *
 * Returns `true` when handled. A {@link BoardStoreError} becomes an error
 * envelope rather than a thrown exception: these are ordinary user-facing
 * outcomes ("that column still has cards"), and the socket must stay open.
 */
export async function handleBoardCommand(
  deps: BoardCommandDeps,
  command: ClientCommand,
  id: string,
): Promise<boolean> {
  const {
    boardRegistry,
    boardSync,
    startWork,
    startWorkView,
    cleanupView,
    resolveCleanup,
    suggestSyncRepo,
    send,
  } = deps
  if (!isBoardCommand(command)) return false

  if (!boardRegistry) {
    send({ v: PROTOCOL_VERSION, type: "error", id, message: "Boards are not available on this server." })
    return true
  }

  try {
    if (command.type === "board.card.startWork") {
      if (!startWork) {
        send({ v: PROTOCOL_VERSION, type: "error", id, message: "Starting work is not available on this server." })
        return true
      }
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: await startWork(command.cardId) })
      return true
    }
    if (command.type === "board.card.resolveWorktree") {
      if (!resolveCleanup) {
        send({ v: PROTOCOL_VERSION, type: "error", id, message: "Worktree cleanup is not available on this server." })
        return true
      }
      send({
        v: PROTOCOL_VERSION,
        type: "ack",
        id,
        result: await resolveCleanup(command.cardId, command.decision),
      })
      return true
    }
    if (command.type === "board.card.detail") {
      const detail = boardRegistry.cardDetail(command.cardId)
      const view: CardDetailView | null = detail
        ? {
            ...detail,
            startWork: startWorkView ? await startWorkView(command.cardId) : null,
            cleanup: cleanupView ? await cleanupView(command.cardId) : null,
          }
        : null
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: view })
      return true
    }
    if (command.type.startsWith("board.sync.")) {
      return await dispatchSync(boardRegistry, boardSync, suggestSyncRepo, send, command, id)
    }
    return dispatch(boardRegistry, send, command, id)
  } catch (error) {
    if (error instanceof BoardStoreError) {
      send({ v: PROTOCOL_VERSION, type: "error", id, message: error.message })
      return true
    }
    send({ v: PROTOCOL_VERSION, type: "error", id, message: errorMessage(error) })
    return true
  }
}

/**
 * Sync commands are async and reach the network, so they are dispatched
 * separately from the synchronous store commands above.
 */
async function dispatchSync(
  registry: BoardRegistry,
  sync: BoardSync | undefined,
  suggestRepo: BoardCommandDeps["suggestSyncRepo"],
  send: (envelope: ServerEnvelope) => void,
  command: ClientCommand,
  id: string,
): Promise<boolean> {
  if (command.type === "board.sync.bind") {
    const binding = registry.bindSync({
      boardId: command.boardId,
      providerId: "github-issues",
      sourceRef: { provider: "github-issues", owner: command.owner, repo: command.repo },
      direction: command.direction,
      allowAgentPush: command.allowAgentPush,
    })
    send({ v: PROTOCOL_VERSION, type: "ack", id, result: binding })
    return true
  }

  if (command.type === "board.sync.status") {
    const columns = registry.listColumns(command.boardId)
    const named = (column: BoardColumn | null): SyncColumnRef | null =>
      column ? { id: column.id, title: column.title } : null
    const status: BoardSyncStatus = {
      binding: registry.getBinding(command.boardId),
      conflicts: registry.listConflicts(command.boardId),
      suggestedRepo: suggestRepo ? await suggestRepo(command.boardId) : null,
      // Shown, not offered: the engine routes by the same function.
      routing: {
        open: named(columnForRemoteState(columns, "open")),
        closed: named(columnForRemoteState(columns, "closed")),
      },
    }
    send({ v: PROTOCOL_VERSION, type: "ack", id, result: status })
    return true
  }

  if (!sync) {
    send({ v: PROTOCOL_VERSION, type: "error", id, message: "Sync is not available on this server." })
    return true
  }

  if (command.type === "board.sync.pull") {
    send({ v: PROTOCOL_VERSION, type: "ack", id, result: await sync.pull(command.boardId) })
    return true
  }

  if (command.type === "board.sync.push") {
    send({ v: PROTOCOL_VERSION, type: "ack", id, result: await sync.drain(command.boardId) })
    return true
  }

  return false
}

function dispatch(
  registry: BoardRegistry,
  send: (envelope: ServerEnvelope) => void,
  command: ClientCommand,
  id: string,
): boolean {
  switch (command.type) {
    case "board.create": {
      // A template supplies the columns and card schema; without one the board
      // starts empty rather than guessing a layout.
      const template = command.templateId ? registry.getTemplate(command.templateId) : null
      const board = registry.createBoard({
        owner: { kind: command.ownerKind, id: command.ownerId },
        title: command.title,
        definition: template?.definition ?? null,
        templateId: template?.id ?? null,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: board })
      return true
    }

    case "board.update": {
      const patch: UpdateBoardPatch = {
        ...(command.title === undefined ? {} : { title: command.title }),
        ...(command.description === undefined ? {} : { description: command.description }),
      }

      if (command.cardFields !== undefined) {
        // Decoded against the domain's rules rather than trusted from the wire,
        // for the reason `board.card.update` gives one case below: the store
        // writes the schema whole and validates nothing. A duplicate field id
        // would leave two fields fighting over one card value, and there is no
        // way back once cards have written through it.
        const cardFields = decodeFieldDefsForWrite(command.cardFields)
        if (!cardFields) {
          send({
            v: PROTOCOL_VERSION,
            type: "error",
            id,
            message:
              "Those card fields are not usable. Each field needs a unique id, a name, a known kind, and option colours from the board palette.",
          })
          return true
        }
        patch.cardFields = cardFields
      }

      send({ v: PROTOCOL_VERSION, type: "ack", id, result: registry.updateBoard(command.boardId, patch) })
      return true
    }

    case "board.duplicate": {
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: registry.duplicateBoard(command.boardId, command.title) })
      return true
    }

    case "board.saveAsTemplate": {
      send({
        v: PROTOCOL_VERSION,
        type: "ack",
        id,
        result: registry.saveBoardAsTemplate(command.boardId, command.name),
      })
      return true
    }

    case "board.archive": {
      registry.archiveBoard(command.boardId)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      return true
    }

    case "board.column.create": {
      const column = registry.createColumn({
        boardId: command.boardId,
        title: command.title,
        afterColumnId: command.afterColumnId ?? null,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: column })
      return true
    }

    case "board.column.update": {
      const column = registry.updateColumn(command.columnId, {
        ...(command.title === undefined ? {} : { title: command.title }),
        ...(command.semantic === undefined ? {} : { semantic: command.semantic }),
        ...(command.colorToken === undefined ? {} : { colorToken: command.colorToken }),
        ...(command.wipLimit === undefined ? {} : { wipLimit: command.wipLimit }),
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: column })
      return true
    }

    case "board.column.move": {
      const column = registry.moveColumn({ columnId: command.columnId, afterColumnId: command.afterColumnId })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: column })
      return true
    }

    case "board.column.delete": {
      registry.deleteColumn(command.columnId)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      return true
    }

    case "board.card.create": {
      const card = registry.createCard({
        boardId: command.boardId,
        columnId: command.columnId,
        title: command.title,
        projectId: command.projectId ?? null,
        afterCardId: command.afterCardId ?? null,
        actor: USER,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: card })
      return true
    }

    case "board.card.move": {
      const card = registry.moveCard({
        cardId: command.cardId,
        toColumnId: command.toColumnId,
        aboveCardId: command.aboveCardId,
        belowCardId: command.belowCardId,
        actor: USER,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: card })
      return true
    }

    case "board.card.archive": {
      registry.archiveCard(command.cardId, USER)
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      return true
    }

    case "board.card.comment": {
      send({
        v: PROTOCOL_VERSION,
        type: "ack",
        id,
        result: registry.addComment(command.cardId, USER, command.body),
      })
      return true
    }

    case "board.card.update": {
      const patch: UpdateCardPatch = command.title === undefined ? {} : { title: command.title }

      if (command.content !== undefined) {
        // Checked against THIS board's schema rather than trusted from the
        // wire: the store replaces a card's content wholesale and validates
        // nothing, so a field the board never declared would persist — and the
        // sender would be acked for it.
        const detail = registry.cardDetail(command.cardId)
        const board = detail ? registry.getBoard(detail.card.boardId) : null
        if (!board) {
          send({ v: PROTOCOL_VERSION, type: "error", id, message: `card ${command.cardId} does not exist` })
          return true
        }
        const content = decodeContentForFields(board.cardFields, command.content)
        if (!content) {
          send({
            v: PROTOCOL_VERSION,
            type: "error",
            id,
            message: "That change does not match this board's card fields.",
          })
          return true
        }
        patch.content = content
      }

      send({ v: PROTOCOL_VERSION, type: "ack", id, result: registry.updateCard(command.cardId, patch, USER) })
      return true
    }

    case "board.cards.page": {
      const page = registry.cardPage({
        columnId: command.columnId,
        limit: command.limit,
        afterRank: command.afterRank ?? null,
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: page })
      return true
    }

    case "board.templates.list": {
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: registry.listTemplates() })
      return true
    }

    default:
      return false
  }
}
