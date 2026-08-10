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
import type { CardActor } from "../shared/boards/types"
import { BoardStoreError } from "./board-store"
import type { BoardRegistry } from "./board-registry"
import { errorMessage } from "../shared/errors"

const USER: CardActor = { kind: "user" }

export interface BoardCommandDeps {
  boardRegistry: BoardRegistry | undefined
  send: (envelope: ServerEnvelope) => void
}

const BOARD_COMMAND_TYPES = new Set<string>([
  "board.create",
  "board.archive",
  "board.update",
  "board.duplicate",
  "board.saveAsTemplate",
  "board.column.create",
  "board.card.create",
  "board.card.move",
  "board.card.archive",
  "board.card.detail",
  "board.cards.page",
  "board.templates.list",
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
export function handleBoardCommand(deps: BoardCommandDeps, command: ClientCommand, id: string): boolean {
  const { boardRegistry, send } = deps
  if (!isBoardCommand(command)) return false

  if (!boardRegistry) {
    send({ v: PROTOCOL_VERSION, type: "error", id, message: "Boards are not available on this server." })
    return true
  }

  try {
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
      const board = registry.updateBoard(command.boardId, {
        ...(command.title === undefined ? {} : { title: command.title }),
        ...(command.description === undefined ? {} : { description: command.description }),
      })
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: board })
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

    case "board.card.detail": {
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: registry.cardDetail(command.cardId) })
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
