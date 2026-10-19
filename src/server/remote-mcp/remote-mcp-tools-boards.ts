import type { ToolRegistrar } from "./remote-mcp-tool-registrar"
import { z } from "zod"
import type { RemoteMcpHost } from "./remote-mcp-server"
import { envelopeToToolResult } from "./remote-mcp-envelope"
import { commandResult } from "./remote-mcp-views"

export function registerBoardTools(tools: ToolRegistrar, host: RemoteMcpHost): void {
  tools.registerTool(
    "list_boards",
    {
      title: "List boards",
      description: "List the kanban boards of a project.",
      inputSchema: z.object({ projectId: z.string().describe("Id of the project") }),
      annotations: { readOnlyHint: true },
    },
    ({ projectId }) => envelopeToToolResult(host.readSnapshot({ type: "boards", ownerKind: "project", ownerId: projectId })),
  )

  tools.registerTool(
    "get_board",
    {
      title: "Read a board",
      description: "Read a board with its columns and the first page of cards in each.",
      inputSchema: z.object({ boardId: z.string().describe("Id of the board") }),
      annotations: { readOnlyHint: true },
    },
    ({ boardId }) => envelopeToToolResult(host.readSnapshot({ type: "board", boardId })),
  )

  tools.registerTool(
    "create_card",
    {
      title: "Create a card",
      description: "Add a card to the end of a board column.",
      inputSchema: z.object({
        boardId: z.string().describe("Id of the board"),
        columnId: z.string().describe("Id of the column that receives the card"),
        title: z.string().describe("Card title"),
      }),
    },
    ({ boardId, columnId, title }) => commandResult(host, { type: "board.card.create", boardId, columnId, title }),
  )

  tools.registerTool(
    "move_card",
    {
      title: "Move a card",
      description: "Move a card to another column, placing it at the end.",
      inputSchema: z.object({
        cardId: z.string().describe("Id of the card"),
        toColumnId: z.string().describe("Id of the destination column"),
      }),
    },
    ({ cardId, toColumnId }) =>
      commandResult(host, { type: "board.card.move", cardId, toColumnId, aboveCardId: null, belowCardId: null }),
  )

  tools.registerTool(
    "comment_card",
    {
      title: "Comment on a card",
      description: "Add a comment to a card.",
      inputSchema: z.object({
        cardId: z.string().describe("Id of the card"),
        body: z.string().describe("Comment text"),
      }),
    },
    ({ cardId, body }) => commandResult(host, { type: "board.card.comment", cardId, body }),
  )

  tools.registerTool(
    "start_work_on_card",
    {
      title: "Start work on a card",
      description: "Create a git worktree and chat for a card and start the agent on it; moves the card to the active column.",
      inputSchema: z.object({ cardId: z.string().describe("Id of the card") }),
    },
    ({ cardId }) => commandResult(host, { type: "board.card.startWork", cardId }),
  )
}
