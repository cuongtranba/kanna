import { z } from "zod"
import { boardOwnerKindSchema } from "../../shared/boards/types.schema"
import { fail } from "../kanna-mcp-tool"
import { envelopeToToolResult } from "./remote-mcp-views"
import { commandTool, topicTool, type RemoteTool } from "./remote-mcp-tool-spec"

const OWNER_CHOICE_MESSAGE = "Give ownerId (with an optional ownerKind), or the legacy projectId on its own. Not both, and not neither."

function oneOwner(args: { ownerId?: string; ownerKind?: string; projectId?: string }, ctx: z.RefinementCtx): void {
  const givenOwner = args.ownerId !== undefined
  const givenLegacy = args.projectId !== undefined
  const legacyClashes = givenLegacy && (givenOwner || (args.ownerKind !== undefined && args.ownerKind !== "project"))
  if (givenOwner === givenLegacy || legacyClashes) ctx.addIssue({ code: "custom", message: OWNER_CHOICE_MESSAGE })
}

export const boardTools: readonly RemoteTool[] = [
  topicTool({
    name: "list_boards",
    title: "List boards",
    description: "List the kanban boards owned by a project or a stack.",
    annotations: { readOnlyHint: true },
    topic: "boards",
    input: z
      .object({
        ownerId: z.string().optional().describe("Id of the project or stack that owns the boards. Give this or the legacy projectId"),
        ownerKind: boardOwnerKindSchema.optional().describe("project (default) or stack"),
        projectId: z.string().optional().describe("Legacy, accepted for compatibility: the id of the project that owns the boards, the same as ownerId with ownerKind project"),
      })
      .superRefine(oneOwner),
    handle: ({ ownerId, ownerKind, projectId }, { host }) => {
      const owner = ownerId ?? projectId
      return owner === undefined
        ? fail(OWNER_CHOICE_MESSAGE)
        : envelopeToToolResult(host.readSnapshot({ type: "boards", ownerKind: ownerKind ?? "project", ownerId: owner }))
    },
  }),
  topicTool({
    name: "get_board",
    title: "Read a board",
    description: "Read a board with its columns and the first page of cards in each.",
    annotations: { readOnlyHint: true },
    topic: "board",
    input: z.object({
      boardId: z.string().describe("Id of the board"),
      pageSize: z.number().int().min(1).optional().describe("How many cards to read per column"),
    }),
    handle: ({ boardId, pageSize }, { host }) => envelopeToToolResult(host.readSnapshot({ type: "board", boardId, pageSize })),
  }),
  commandTool({
    name: "create_card",
    title: "Create a card",
    description: "Add a card to a board column. It lands at the top of the column unless afterCardId places it after another card.",
    command: "board.card.create",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "board.card.create", ...args }),
  }),
  commandTool({
    name: "move_card",
    title: "Move a card",
    description: "Move a card to a column. aboveCardId and belowCardId name the neighbours it should land between; null means the top or the bottom of the column.",
    command: "board.card.move",
    input: (params) => params.extend({
      aboveCardId: params.shape.aboveCardId.optional().describe(`${params.shape.aboveCardId.description ?? "The card above"}. Optional, null when omitted`),
      belowCardId: params.shape.belowCardId.optional().describe(`${params.shape.belowCardId.description ?? "The card below"}. Optional, null when omitted`),
    }),
    handle: ({ aboveCardId, belowCardId, ...args }, { run }) =>
      run({ type: "board.card.move", ...args, aboveCardId: aboveCardId ?? null, belowCardId: belowCardId ?? null }),
  }),
  commandTool({
    name: "comment_card",
    title: "Comment on a card",
    description: "Add a comment to a card.",
    command: "board.card.comment",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "board.card.comment", ...args }),
  }),
  commandTool({
    name: "start_work_on_card",
    title: "Start work on a card",
    description: "Create a git worktree and chat for a card and start the agent on it; moves the card to the active column.",
    command: "board.card.startWork",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "board.card.startWork", ...args }),
  }),
]
