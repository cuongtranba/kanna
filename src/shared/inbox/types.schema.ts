import { z } from "zod"
import type { InboxActivityItem, InboxFilter, InboxThread } from "./types"
import { jsonValueSchema } from "../genui/json-schema"
import { assertParity } from "../type-parity"

export const inboxFilterSchema = z.object({
  sourceKind: z.enum(["store", "transcript", "webhook", "mcp", "inbox"]).optional(),
  projectId: z.string().optional(),
  chatId: z.string().optional(),
  attentionOnly: z.boolean().optional(),
})

const busSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("store"), log: z.string() }),
  z.object({ kind: z.literal("transcript"), chatId: z.string() }),
  z.object({ kind: z.literal("webhook"), hookId: z.string(), hookName: z.string() }),
  z.object({
    kind: z.literal("mcp"),
    sourceId: z.string(),
    sourceName: z.string(),
    serverId: z.string(),
    serverName: z.string(),
  }),
  z.object({ kind: z.literal("inbox") }),
])

const inboxThreadSchema = z.object({
  id: z.string(),
  sourceKind: z.enum(["webhook", "mcp"]),
  sourceId: z.string(),
  sourceName: z.string(),
  threadKey: z.string(),
  sender: z.string(),
  messages: z.array(z.object({
    id: z.string(),
    deliveryId: z.string(),
    ts: z.number(),
    payload: jsonValueSchema,
    preview: z.string(),
  })),
  chatId: z.string().optional(),
  state: z.enum(["new", "needs_you", "fyi", "handled", "replied", "archived"]),
  report: z.object({
    verdict: z.enum(["needs_you", "fyi", "handled"]),
    summary: z.string(),
    draftReply: z.string().optional(),
    at: z.number(),
    chatId: z.string(),
  }).optional(),
  unread: z.boolean(),
  lastMessageAt: z.number(),
  replyCount: z.number(),
  pendingScheduleId: z.string().optional(),
})

const inboxActivityItemSchema = z.object({
  id: z.string(),
  ts: z.number(),
  subject: z.string(),
  source: busSourceSchema,
  chatId: z.string().optional(),
  projectId: z.string().optional(),
  title: z.string(),
  preview: z.string(),
  payload: jsonValueSchema,
  attention: z.boolean(),
  unread: z.boolean(),
})

export const inboxPageSchema = z.object({
  threads: z.array(inboxThreadSchema),
  items: z.array(inboxActivityItemSchema),
})

export type InboxPage = z.output<typeof inboxPageSchema>

assertParity<z.output<typeof inboxThreadSchema>, InboxThread>()
assertParity<z.output<typeof inboxActivityItemSchema>, InboxActivityItem>()
assertParity<z.output<typeof inboxFilterSchema>, InboxFilter>()
