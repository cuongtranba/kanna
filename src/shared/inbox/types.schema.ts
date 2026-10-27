import { z } from "zod"
import {
  INBOX_SOURCE_KINDS,
  INBOX_THREAD_STATES,
  INBOX_VERDICTS,
  type InboxActivityItem,
  type InboxFilter,
  type InboxThread,
} from "./types"
import { BUS_SOURCE_KINDS, type BusSource } from "../service-bus/envelope"
import { jsonValueSchema } from "../genui/json-schema"
import { assertParity } from "../type-parity"

export const inboxFilterSchema = z.object({
  sourceKind: z.enum(BUS_SOURCE_KINDS).optional(),
  projectId: z.string().optional(),
  chatId: z.string().optional(),
  attentionOnly: z.boolean().optional(),
})

export const busSourceSchema = z.discriminatedUnion("kind", [
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

export const inboundMessageSchema = z.object({
  id: z.string(),
  deliveryId: z.string(),
  ts: z.number(),
  payload: jsonValueSchema,
  preview: z.string(),
})

export const inboxReportSchema = z.object({
  verdict: z.enum(INBOX_VERDICTS),
  summary: z.string(),
  draftReply: z.string().optional(),
  at: z.number(),
  chatId: z.string(),
})

const inboxThreadSchema = z.object({
  id: z.string(),
  sourceKind: z.enum(INBOX_SOURCE_KINDS),
  sourceId: z.string(),
  sourceName: z.string(),
  threadKey: z.string(),
  sender: z.string(),
  messages: z.array(inboundMessageSchema),
  chatId: z.string().optional(),
  state: z.enum(INBOX_THREAD_STATES),
  report: inboxReportSchema.optional(),
  unread: z.boolean(),
  lastMessageAt: z.number(),
  replyCount: z.number(),
  pendingScheduleId: z.string().optional(),
})

export const inboxThreadHeaderSchema = inboxThreadSchema.pick({
  id: true,
  sourceKind: true,
  sourceId: true,
  sourceName: true,
  threadKey: true,
  sender: true,
})

export const inboxActivityItemSchema = z.object({
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

assertParity<z.output<typeof busSourceSchema>, BusSource>()
assertParity<z.output<typeof inboxThreadSchema>, InboxThread>()
assertParity<z.output<typeof inboxActivityItemSchema>, InboxActivityItem>()
assertParity<z.output<typeof inboxFilterSchema>, InboxFilter>()
