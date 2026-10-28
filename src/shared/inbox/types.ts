import type { JsonValue } from "../json"
import type { BusSource } from "../service-bus/envelope"
import { oneOf } from "../vocab"

export const INBOX_THREAD_STATES = ["new", "needs_you", "fyi", "handled", "replied", "archived"] as const
export type InboxThreadState = (typeof INBOX_THREAD_STATES)[number]

export const INBOX_VERDICTS = ["needs_you", "fyi", "handled"] as const
export type InboxVerdict = (typeof INBOX_VERDICTS)[number]

export const INBOX_SOURCE_KINDS = ["webhook", "mcp"] as const
export type InboxSourceKind = (typeof INBOX_SOURCE_KINDS)[number]

export interface InboundMessage {
  id: string
  deliveryId: string
  ts: number
  payload: JsonValue
  preview: string
}

export interface InboxReport {
  verdict: InboxVerdict
  summary: string
  draftReply?: string
  at: number
  chatId: string
}

export interface InboxThread {
  id: string
  sourceKind: InboxSourceKind
  sourceId: string
  sourceName: string
  threadKey: string
  sender: string
  messages: InboundMessage[]
  chatId?: string
  state: InboxThreadState
  report?: InboxReport
  unread: boolean
  lastMessageAt: number
  replyCount: number
  pendingScheduleId?: string
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
export const INBOX_THREAD_MAX_MESSAGES = 50

export const isInboxVerdict = oneOf(INBOX_VERDICTS)
