import { z } from "zod"
import type { JsonValue } from "../json"
import { assertParity } from "../type-parity"
import type { InboundMessage, InboxActivityItem, InboxReport, InboxThread } from "./types"
import {
  inboundMessageSchema,
  inboxActivityItemSchema,
  inboxReportSchema,
  inboxThreadHeaderSchema,
} from "./types.schema"

export type InboxThreadHeader = Pick<InboxThread, "id" | "sourceKind" | "sourceId" | "sourceName" | "threadKey" | "sender">

interface InboxEventBase {
  v: 1
  ts: number
}

export type InboxEvent =
  | (InboxEventBase & { kind: "inbox_activity_added"; item: InboxActivityItem })
  | (InboxEventBase & { kind: "inbox_thread_message_added"; thread: InboxThreadHeader; message: InboundMessage })
  | (InboxEventBase & { kind: "inbox_thread_chat_bound"; threadId: string; chatId: string })
  | (InboxEventBase & { kind: "inbox_thread_reported"; threadId: string; report: InboxReport })
  | (InboxEventBase & { kind: "inbox_thread_pending"; threadId: string; scheduleId: string })
  | (InboxEventBase & { kind: "inbox_thread_read"; ids: string[] })
  | (InboxEventBase & { kind: "inbox_all_read"; beforeTs: number })
  | (InboxEventBase & { kind: "inbox_thread_replied"; threadId: string; chatId: string; scheduleId: string })
  | (InboxEventBase & { kind: "inbox_thread_archived"; threadId: string })

export type InboxEventKind = InboxEvent["kind"]

const eventBase = { v: z.literal(1), ts: z.number() }

const inboxEventSchema = z.discriminatedUnion("kind", [
  z.object({ ...eventBase, kind: z.literal("inbox_activity_added"), item: inboxActivityItemSchema }),
  z.object({
    ...eventBase,
    kind: z.literal("inbox_thread_message_added"),
    thread: inboxThreadHeaderSchema,
    message: inboundMessageSchema,
  }),
  z.object({ ...eventBase, kind: z.literal("inbox_thread_chat_bound"), threadId: z.string(), chatId: z.string() }),
  z.object({ ...eventBase, kind: z.literal("inbox_thread_reported"), threadId: z.string(), report: inboxReportSchema }),
  z.object({ ...eventBase, kind: z.literal("inbox_thread_pending"), threadId: z.string(), scheduleId: z.string() }),
  z.object({ ...eventBase, kind: z.literal("inbox_thread_read"), ids: z.array(z.string()) }),
  z.object({ ...eventBase, kind: z.literal("inbox_all_read"), beforeTs: z.number() }),
  z.object({
    ...eventBase,
    kind: z.literal("inbox_thread_replied"),
    threadId: z.string(),
    chatId: z.string(),
    scheduleId: z.string(),
  }),
  z.object({ ...eventBase, kind: z.literal("inbox_thread_archived"), threadId: z.string() }),
])

assertParity<z.output<typeof inboxEventSchema>, InboxEvent>()

export function parseInboxEvent(value: JsonValue): InboxEvent | null {
  const parsed = inboxEventSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
