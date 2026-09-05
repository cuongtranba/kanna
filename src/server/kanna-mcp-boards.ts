
import { z } from "zod"
import type { BoardRegistry } from "./board-registry"
import { BoardStoreError } from "./board-store"
import { errorMessage } from "../shared/errors"
import type { JsonValue } from "../shared/json"
import type { CardActor } from "../shared/boards/types"
import { ok, fail, type ToolArgs, type ToolResult } from "./kanna-mcp-tool"

const CARD_WINDOW = 20

const BOARD_LIST_DESCRIPTION =
  "List the kanban boards for this chat's project. Returns id, title and card counts only — "
  + "call board_get for a board's columns and cards."

const BOARD_GET_DESCRIPTION =
  "Read one board: its columns, the TOTAL card count per column, and the first "
  + `${String(CARD_WINDOW)} cards of each. Never returns a whole board — pass column_id to focus one column.`

const CARD_MOVE_DESCRIPTION =
  "Move a card to another column, e.g. advancing your assigned card from 'in progress' to 'test'. "
  + "The move is attributed to you, which is what keeps it from being pushed to a connected tracker "
  + "unless that board opted in."

const CARD_CREATE_DESCRIPTION = "Add a card to a column on a board in this chat's project."

const CARD_COMMENT_DESCRIPTION =
  "Leave a comment on a card — what you did, what you found, why you moved it."

export interface BoardToolDeps {
  boardRegistry?: BoardRegistry
  chatId: string | null
  projectId: string | null
}

function requireString(value: JsonValue | undefined, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BoardStoreError("invalid_input", `${name} is required`)
  }
  return value
}

export type BoardToolFactory<TTool> = (
  name: string,
  description: string,
  schema: Record<string, z.ZodType<JsonValue | undefined>>,
  handler: (input: ToolArgs) => Promise<ToolResult>,
) => TTool

export function buildBoardToolList<TTool>(deps: BoardToolDeps, tool: BoardToolFactory<TTool>): TTool[] {
  const { boardRegistry, chatId, projectId } = deps
  if (!boardRegistry || !chatId || !projectId) return []

  const registry = boardRegistry
  const owner = projectId
  const actor: CardActor = { kind: "agent", chatId }

  function requireBoard(boardId: string) {
    const board = registry.boardView(boardId)
    if (!board) throw new BoardStoreError("not_found", `board ${boardId} does not exist`)
    if (board.board.ownerKind !== "project" || board.board.ownerId !== owner) {
      throw new BoardStoreError("invalid_input", "that board belongs to another project")
    }
    return board
  }

  function requireCardBoard(cardId: string) {
    const card = registry.cardDetail(cardId)
    if (!card) throw new BoardStoreError("not_found", `card ${cardId} does not exist`)
    requireBoard(card.card.boardId)
    return card.card
  }

  async function guarded(run: () => ToolResult): Promise<ToolResult> {
    try {
      return run()
    } catch (error) {
      if (error instanceof BoardStoreError) return fail(error.message)
      return fail(errorMessage(error))
    }
  }

  return [
    tool("board_list", BOARD_LIST_DESCRIPTION, {}, () =>
      guarded(() => {
        const boards = registry.listBoards({ kind: "project", id: owner })
        if (boards.length === 0) return ok("This project has no boards.")
        return ok(
          boards
            .map((board) => `${board.id}  ${board.title}  (${String(board.cardCount)} cards)`)
            .join("\n"),
        )
      }),
    ),

    tool(
      "board_get",
      BOARD_GET_DESCRIPTION,
      {
        board_id: z.string().describe("Board id from board_list."),
        column_id: z
          .string()
          .optional()
          .describe("Restrict to one column. Omit for every column."),
      },
      (input) =>
        guarded(() => {
          const boardIdArg = requireString(input.board_id, "board_id")
          const columnIdArg = typeof input.column_id === "string" ? input.column_id : null
          const view = requireBoard(boardIdArg)
          const columns = columnIdArg
            ? view.columns.filter((column) => column.id === columnIdArg)
            : view.columns
          if (columns.length === 0) return fail("no such column on that board")

          const lines = columns.map((column) => {
            const total = view.counts[column.id] ?? 0
            const cards = (view.cards[column.id] ?? []).slice(0, CARD_WINDOW)
            const shown = cards.map((card) => `    ${card.id}  ${card.title}`).join("\n")
            const elision = total > cards.length ? `\n    … ${String(total - cards.length)} more` : ""
            return `${column.title}${column.semantic ? ` [${column.semantic}]` : ""} — ${String(total)} cards\n${shown}${elision}`
          })
          return ok(lines.join("\n\n"))
        }),
    ),

    tool(
      "card_move",
      CARD_MOVE_DESCRIPTION,
      {
        card_id: z.string().describe("Card id from board_get."),
        to_column_id: z.string().describe("Destination column id from board_get."),
      },
      (input) =>
        guarded(() => {
          const card = requireCardBoard(requireString(input.card_id, "card_id"))
          const moved = registry.moveCard({
            cardId: card.id,
            toColumnId: requireString(input.to_column_id, "to_column_id"),
            aboveCardId: null,
            belowCardId: null,
            actor,
          })
          return ok(`Moved "${moved.title}" to column ${moved.columnId}.`)
        }),
    ),

    tool(
      "card_create",
      CARD_CREATE_DESCRIPTION,
      {
        board_id: z.string().describe("Board id from board_list."),
        column_id: z.string().describe("Column id from board_get."),
        title: z.string().min(1).describe("One line naming the work."),
      },
      (input) =>
        guarded(() => {
          const boardIdArg = requireString(input.board_id, "board_id")
          requireBoard(boardIdArg)
          const card = registry.createCard({
            boardId: boardIdArg,
            columnId: requireString(input.column_id, "column_id"),
            title: requireString(input.title, "title"),
            projectId: owner,
            actor,
          })
          return ok(`Created card ${card.id}.`)
        }),
    ),

    tool(
      "card_comment",
      CARD_COMMENT_DESCRIPTION,
      {
        card_id: z.string().describe("Card id from board_get."),
        body: z.string().min(1).describe("What to record on the card."),
      },
      (input) =>
        guarded(() => {
          const card = requireCardBoard(requireString(input.card_id, "card_id"))
          registry.addComment(card.id, actor, requireString(input.body, "body"))
          return ok(`Commented on "${card.title}".`)
        }),
    ),
  ]
}
