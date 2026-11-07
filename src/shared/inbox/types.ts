import type { JsonValue } from "../json"
import type { BusSource } from "../service-bus/envelope"
import { oneOf } from "../vocab"
import type { InboxAutonomyLevel } from "./autonomy"

export const INBOX_THREAD_STATES = ["new", "needs_you", "fyi", "handled", "replied", "archived"] as const
export type InboxThreadState = (typeof INBOX_THREAD_STATES)[number]

export const INBOX_UNSNOOZE_REASONS = ["time", "message", "user"] as const
export type InboxUnsnoozeReason = (typeof INBOX_UNSNOOZE_REASONS)[number]

export const INBOX_VERDICTS = ["needs_you", "fyi", "handled"] as const
export type InboxVerdict = (typeof INBOX_VERDICTS)[number]

export const INBOX_SOURCE_KINDS = ["webhook", "mcp"] as const
export type InboxSourceKind = (typeof INBOX_SOURCE_KINDS)[number]

export const INBOX_OUTBOUND_SETTLED_STATUSES = ["sent", "failed", "unknown"] as const
export type InboxOutboundSettledStatus = (typeof INBOX_OUTBOUND_SETTLED_STATUSES)[number]

export const INBOX_OUTBOUND_STATUSES = ["pending", ...INBOX_OUTBOUND_SETTLED_STATUSES] as const
export type InboxOutboundStatus = (typeof INBOX_OUTBOUND_STATUSES)[number]

export const INBOX_OUTBOUND_BYS = ["you", "approved", "agent"] as const
export type InboxOutboundBy = (typeof INBOX_OUTBOUND_BYS)[number]

export interface InboxOutboundProvenance {
  id: string
  confidence: number
  reason: string
}

export interface InboxOutboundMessage {
  id: string
  ts: number
  text: string
  by: InboxOutboundBy
  proposal?: InboxOutboundProvenance
  status: InboxOutboundStatus
  error?: string
  resultId?: string
  settledAt?: number
  retryOf?: string
}

export const INBOX_OUTBOUND_RESTART_ERROR = "Kanna restarted before the send finished"

export interface InboundMessage {
  id: string
  deliveryId: string
  ts: number
  payload: JsonValue
  preview: string
  text?: string
}

export interface InboxReport {
  verdict: InboxVerdict
  summary: string
  draftReply?: string
  at: number
  chatId: string
}

export const INBOX_DRAFT_ORIGINS = ["triage", "ask", "proposal"] as const
export type InboxDraftOrigin = (typeof INBOX_DRAFT_ORIGINS)[number]

export interface InboxDraft {
  id: string
  text: string
  at: number
  origin: InboxDraftOrigin
  instruction?: string
}

export const INBOX_PROPOSAL_STATUSES = ["open", "scheduled"] as const
export type InboxProposalStatus = (typeof INBOX_PROPOSAL_STATUSES)[number]

export const INBOX_PROPOSAL_RESOLUTIONS = ["sent", "rejected", "cancelled", "expired"] as const
export type InboxProposalResolution = (typeof INBOX_PROPOSAL_RESOLUTIONS)[number]

export interface InboxProposal {
  id: string
  text: string
  confidence: number
  reason: string
  at: number
  status: InboxProposalStatus
  scheduledFor?: number
  blockedBy?: string
}

export interface InboxProposeSend {
  text: string
  confidence: number
  reason: string
}

export const INBOX_PROPOSAL_RESTART_BLOCKED_BY = "Kanna restarted before the auto-send"

export interface InboxThread {
  id: string
  sourceKind: InboxSourceKind
  sourceId: string
  sourceName: string
  threadKey: string
  sender: string
  messages: InboundMessage[]
  outbound: InboxOutboundMessage[]
  drafts: InboxDraft[]
  chatId?: string
  state: InboxThreadState
  report?: InboxReport
  unread: boolean
  lastMessageAt: number
  replyCount: number
  pendingScheduleId?: string
  autonomy?: InboxAutonomyLevel
  agentPausedUntil?: number
  snoozedUntil?: number
  proposal?: InboxProposal
  muted: boolean
}

export interface InboxActivityItem {
  id: string
  ts: number
  subject: string
  source: BusSource
  chatId?: string
  projectId?: string
  title: string
  preview: string
  payload: JsonValue
  attention: boolean
  unread: boolean
}

export interface InboxFilter {
  sourceKind?: BusSource["kind"]
  projectId?: string
  chatId?: string
  attentionOnly?: boolean
  sentByAgent?: boolean
}

export interface InboxSnapshot {
  threads: InboxThread[]
  items: InboxActivityItem[]
  unreadCount: number
  total: number
}

export const INBOX_MAX_ITEMS = 2000
export const INBOX_SUMMARY_MAX_CHARS = 600
export const INBOX_DRAFT_MAX_CHARS = 4000
export const INBOX_REPLY_MAX_CHARS = 8000
export const INBOX_UNREAD_KEEP_MS = 7 * 24 * 60 * 60 * 1000
export const INBOX_PREVIEW_MAX_CHARS = 160
export const INBOX_MESSAGE_TEXT_MAX_CHARS = 4000
export const INBOX_THREAD_MAX_MESSAGES = 50
export const INBOX_THREAD_MAX_DRAFTS = 5
export const INBOX_DRAFT_INSTRUCTION_MAX_CHARS = 200

export const isInboxVerdict = oneOf(INBOX_VERDICTS)
