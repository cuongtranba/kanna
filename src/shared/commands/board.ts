import { z } from "zod"
import { defineCommand, defineCommands, noParams, REMOTE_ALLOWED } from "./define"
import { jsonValueSchema } from "../genui/json-schema"
import {
  boardOwnerKindSchema,
  cleanupDecisionSchema,
  columnColorTokenSchema,
  columnSemanticSchema,
  syncDirectionSchema,
} from "../boards/types.schema"

const boardIdParams = z.object({ boardId: z.string() })
const cardIdParams = z.object({ cardId: z.string().describe("Id of the card") })
const columnIdParams = z.object({ columnId: z.string() })
const cardBlockerParams = z.object({ cardId: z.string(), blockedByCardId: z.string() })

export const boardCommands = defineCommands(
  defineCommand("board.create", {
    params: z.object({
      ownerKind: boardOwnerKindSchema,
      ownerId: z.string(),
      title: z.string(),
      templateId: z.string().nullable().optional(),
    }),
    summary: "Create a board for a project or stack, optionally from a template.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.archive", {
    params: boardIdParams,
    summary: "Archive a board.",
    risk: "destructive",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.update", {
    params: z.object({
      boardId: z.string(),
      title: z.string().optional(),
      description: z.string().nullable().optional(),
      cardFields: jsonValueSchema.optional(),
    }),
    summary: "Update a board's title, description or card fields.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.duplicate", {
    params: z.object({ boardId: z.string(), title: z.string() }),
    summary: "Duplicate a board under a new title.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.saveAsTemplate", {
    params: z.object({ boardId: z.string(), name: z.string() }),
    summary: "Save a board's columns as a reusable template.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.sync.bind", {
    params: z.object({
      boardId: z.string(),
      owner: z.string(),
      repo: z.string(),
      direction: syncDirectionSchema,
      allowAgentPush: z.boolean(),
      projectId: z.string().nullable().optional(),
      detachFromBoardId: z.string().nullable().optional(),
    }),
    summary: "Bind a board to a GitHub repository's issues.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.sync.unbind", {
    params: z.object({ boardId: z.string(), bindingId: z.string() }),
    summary: "Remove a board's GitHub binding.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.sync.pull", {
    params: boardIdParams,
    summary: "Pull issues from the bound GitHub repository into the board.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.sync.push", {
    params: boardIdParams,
    summary: "Push held board changes to the bound GitHub repository.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.sync.status", {
    params: boardIdParams,
    summary: "Read the sync status of a board.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.column.create", {
    params: z.object({ boardId: z.string(), title: z.string(), afterColumnId: z.string().nullable().optional() }),
    summary: "Add a column to a board.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.column.update", {
    params: z.object({
      columnId: z.string(),
      title: z.string().optional(),
      semantic: columnSemanticSchema.nullable().optional(),
      colorToken: columnColorTokenSchema.nullable().optional(),
      wipLimit: z.number().nullable().optional(),
    }),
    summary: "Update a column's title, semantic, colour or WIP limit.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.column.move", {
    params: z.object({ columnId: z.string(), afterColumnId: z.string().nullable() }),
    summary: "Reorder a column.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.column.delete", {
    params: columnIdParams,
    summary: "Delete a column.",
    risk: "destructive",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.card.create", {
    params: z.object({
      boardId: z.string().describe("Id of the board"),
      columnId: z.string().describe("Id of the column that receives the card"),
      title: z.string().describe("Card title"),
      projectId: z.string().nullable().optional().describe("Project the card belongs to, when it differs from the board's"),
      afterCardId: z.string().nullable().optional().describe("Place the card directly after this card instead of at the end"),
    }),
    summary: "Create a card in a column.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.card.move", {
    params: z.object({
      cardId: z.string().describe("Id of the card"),
      toColumnId: z.string().describe("Id of the destination column"),
      aboveCardId: z.string().nullable().describe("Id of the card that ends up directly above the moved card, or null at the top of the column"),
      belowCardId: z.string().nullable().describe("Id of the card that ends up directly below the moved card, or null at the bottom of the column"),
    }),
    summary: "Move a card to a column position.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.card.archive", {
    params: cardIdParams,
    summary: "Archive a card.",
    risk: "destructive",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.card.detail", {
    params: cardIdParams,
    summary: "Read a card with its comments, links and blockers.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.card.comment", {
    params: z.object({ cardId: z.string().describe("Id of the card"), body: z.string().describe("Comment text") }),
    summary: "Add a comment to a card.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.card.block", {
    params: cardBlockerParams,
    summary: "Mark a card as blocked by another card.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.card.unblock", {
    params: cardBlockerParams,
    summary: "Remove a blocker from a card.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.card.update", {
    params: z.object({ cardId: z.string(), title: z.string().optional(), content: jsonValueSchema.optional() }),
    summary: "Update a card's title or content.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.card.startWork", {
    params: cardIdParams,
    summary: "Create a worktree and chat for a card and start the agent.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.card.resolveWorktree", {
    params: z.object({ cardId: z.string(), decision: cleanupDecisionSchema }),
    summary: "Merge, discard or keep the worktree of a finished card.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.cards.page", {
    params: z.object({ columnId: z.string(), limit: z.number(), afterRank: z.string().nullable().optional() }),
    summary: "Read a page of cards in a column.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("board.templates.list", {
    params: noParams,
    summary: "List board templates.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
)
