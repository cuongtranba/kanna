import type { InboundBusSource } from "../service-bus/envelope"

export type InboxHandlerTurnKind = "triage" | "ask" | "agent-reply"

const WEBHOOK_PREFIX = "webhook-"
const MCP_PREFIX = "mcp-"
const INSTRUCT_PREFIX = "inbox-instruct-"
const REPLY_PREFIX = "inbox-reply-"

const PREFIX_KINDS: readonly (readonly [string, InboxHandlerTurnKind])[] = [
  [WEBHOOK_PREFIX, "triage"],
  [MCP_PREFIX, "triage"],
  [INSTRUCT_PREFIX, "ask"],
  [REPLY_PREFIX, "agent-reply"],
]

export function inboxHandlerTurnKind(scheduleId: string | undefined): InboxHandlerTurnKind | null {
  if (scheduleId === undefined) return null
  return PREFIX_KINDS.find(([prefix]) => scheduleId.startsWith(prefix))?.[1] ?? null
}

export function inboundScheduleId(source: InboundBusSource, deliveryId: string): string {
  return source.kind === "webhook" ? `${WEBHOOK_PREFIX}${source.hookId}-${deliveryId}` : `${MCP_PREFIX}${source.sourceId}-${deliveryId}`
}

export function inboxInstructScheduleId(threadId: string, at: number): string {
  return `${INSTRUCT_PREFIX}${threadId}-${at}`
}

export function inboxReplyScheduleId(threadId: string, replyNumber: number): string {
  return `${REPLY_PREFIX}${threadId}-${replyNumber}`
}

export function isInboxInstructScheduleId(scheduleId: string | undefined): boolean {
  return inboxHandlerTurnKind(scheduleId) === "ask"
}
