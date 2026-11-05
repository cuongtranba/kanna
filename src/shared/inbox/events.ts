import { z } from "zod"
import type { JsonValue } from "../json"
import { assertParity } from "../type-parity"
import { INBOX_AUTONOMY_LEVELS, type InboxAutonomyLevel } from "./autonomy"
import {
  INBOX_OUTBOUND_SETTLED_STATUSES,
  INBOX_PROPOSAL_RESOLUTIONS,
  type InboundMessage,
  type InboxActivityItem,
  type InboxDraft,
  type InboxOutboundMessage,
  type InboxOutboundSettledStatus,
  type InboxProposal,
  type InboxProposalResolution,
  type InboxReport,
  type InboxThread,
} from "./types"
import {
  inboundMessageSchema,
  inboxActivityItemSchema,
  inboxDraftSchema,
  inboxOutboundMessageSchema,
  inboxProposalSchema,
  inboxReportSchema,
  inboxThreadHeaderSchema,
} from "./types.schema"

export type InboxThreadHeader = Pick<InboxThread, "id" | "sourceKind" | "sourceId" | "sourceName" | "threadKey" | "sender">

export type InboxQueuedOutbound = Pick<InboxOutboundMessage, "id" | "ts" | "text" | "by" | "retryOf" | "proposal">

interface InboxEventBase {
  v: 1
  ts: number
}

export type InboxEvent =
  | (InboxEventBase & { kind: "inbox_activity_added"; item: InboxActivityItem })
  | (InboxEventBase & { kind: "inbox_thread_message_added"; thread: InboxThreadHeader; message: InboundMessage })
  | (InboxEventBase & { kind: "inbox_thread_chat_bound"; threadId: string; chatId: string })
  | (InboxEventBase & { kind: "inbox_thread_reported"; threadId: string; report: InboxReport })
  | (InboxEventBase & { kind: "inbox_thread_pending"; threadId: string; scheduleId: string; instruction?: string })
  | (InboxEventBase & { kind: "inbox_thread_draft_added"; threadId: string; draft: InboxDraft })
  | (InboxEventBase & { kind: "inbox_thread_read"; ids: string[] })
  | (InboxEventBase & { kind: "inbox_all_read"; beforeTs: number })
  | (InboxEventBase & { kind: "inbox_thread_replied"; threadId: string; chatId: string; scheduleId: string })
  | (InboxEventBase & { kind: "inbox_thread_archived"; threadId: string })
  | (InboxEventBase & { kind: "inbox_thread_outbound_queued"; threadId: string; outbound: InboxQueuedOutbound })
  | (InboxEventBase & { kind: "inbox_thread_autonomy_set"; threadId: string; level: InboxAutonomyLevel | null })
  | (InboxEventBase & { kind: "inbox_thread_agent_paused"; threadId: string; until: number | null })
  | (InboxEventBase & { kind: "inbox_thread_proposal_added"; threadId: string; proposal: InboxProposal })
  | (InboxEventBase & {
      kind: "inbox_thread_proposal_resolved"
      threadId: string
      proposalId: string
      resolution: InboxProposalResolution
      outboundId?: string
      at: number
    })
  | (InboxEventBase & {
      kind: "inbox_thread_outbound_settled"
      threadId: string
      outboundId: string
      status: InboxOutboundSettledStatus
      error?: string
      resultId?: string
      at: number
    })

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
  z.object({
    ...eventBase,
    kind: z.literal("inbox_thread_pending"),
    threadId: z.string(),
    scheduleId: z.string(),
    instruction: z.string().optional(),
  }),
  z.object({ ...eventBase, kind: z.literal("inbox_thread_draft_added"), threadId: z.string(), draft: inboxDraftSchema }),
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
  z.object({
    ...eventBase,
    kind: z.literal("inbox_thread_outbound_queued"),
    threadId: z.string(),
    outbound: inboxOutboundMessageSchema.pick({ id: true, ts: true, text: true, by: true, retryOf: true, proposal: true }),
  }),
  z.object({
    ...eventBase,
    kind: z.literal("inbox_thread_autonomy_set"),
    threadId: z.string(),
    level: z.enum(INBOX_AUTONOMY_LEVELS).nullable(),
  }),
  z.object({ ...eventBase, kind: z.literal("inbox_thread_agent_paused"), threadId: z.string(), until: z.number().nullable() }),
  z.object({ ...eventBase, kind: z.literal("inbox_thread_proposal_added"), threadId: z.string(), proposal: inboxProposalSchema }),
  z.object({
    ...eventBase,
    kind: z.literal("inbox_thread_proposal_resolved"),
    threadId: z.string(),
    proposalId: z.string(),
    resolution: z.enum(INBOX_PROPOSAL_RESOLUTIONS),
    outboundId: z.string().optional(),
    at: z.number(),
  }),
  z.object({
    ...eventBase,
    kind: z.literal("inbox_thread_outbound_settled"),
    threadId: z.string(),
    outboundId: z.string(),
    status: z.enum(INBOX_OUTBOUND_SETTLED_STATUSES),
    error: z.string().optional(),
    resultId: z.string().optional(),
    at: z.number(),
  }),
])

assertParity<z.output<typeof inboxEventSchema>, InboxEvent>()

export function parseInboxEvent(value: JsonValue): InboxEvent | null {
  const parsed = inboxEventSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
