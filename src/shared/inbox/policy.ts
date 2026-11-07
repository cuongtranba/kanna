import type { BusEnvelope } from "../service-bus/envelope"
import { namedBusSubject } from "../service-bus/subjects"
import { isJsonObject, type JsonValue } from "../json"
import { INBOX_REPLY_MAX_CHARS, type InboxActivityItem, type InboxFilter, type InboxThread } from "./types"

const TOOL_REQUEST_PUT = namedBusSubject("toolRequestPut")
const TOOL_REQUEST_RESOLVED = namedBusSubject("toolRequestResolved")

const OUTCOME_SUBJECTS: ReadonlySet<string> = new Set([namedBusSubject("cronRunOutcome"), namedBusSubject("loopRunOutcome")])

export const ATTENTION_SUBJECTS: ReadonlySet<string> = new Set([
  namedBusSubject("turnFailed"),
  TOOL_REQUEST_PUT,
  namedBusSubject("subagentFailed"),
  ...OUTCOME_SUBJECTS,
])

type SubjectPayload = Pick<BusEnvelope, "subject" | "payload">

function putRequest(payload: JsonValue): JsonValue {
  return isJsonObject(payload) ? (payload.request ?? null) : null
}

export function isAttention(envelope: SubjectPayload): boolean {
  if (!ATTENTION_SUBJECTS.has(envelope.subject)) return false
  if (envelope.subject === TOOL_REQUEST_PUT) {
    const request = putRequest(envelope.payload)
    return isJsonObject(request) && request.policyVerdict === "ask"
  }
  if (!OUTCOME_SUBJECTS.has(envelope.subject)) return true
  return isJsonObject(envelope.payload) && envelope.payload.ok === false
}

export function settledToolRequestId(envelope: SubjectPayload): string | null {
  if (envelope.subject !== TOOL_REQUEST_RESOLVED || !isJsonObject(envelope.payload)) return null
  return typeof envelope.payload.id === "string" ? envelope.payload.id : null
}

export function isToolRequestPutFor(envelope: SubjectPayload, requestId: string): boolean {
  if (envelope.subject !== TOOL_REQUEST_PUT) return false
  const request = putRequest(envelope.payload)
  return isJsonObject(request) && request.id === requestId
}

export function inboxTab(entry: InboxThread | InboxActivityItem): boolean {
  if ("messages" in entry) return !entry.muted && (entry.state === "new" || entry.state === "needs_you" || entry.state === "fyi")
  return entry.attention
}

export function raisesNotification(thread: Pick<InboxThread, "state">): boolean {
  return thread.state === "needs_you"
}

export type OutboundRetryState =
  | { kind: "retryable" }
  | { kind: "needs_confirm" }
  | { kind: "refused"; reason: string }

export function outboundRetryState(thread: Pick<InboxThread, "outbound">, outboundId: string): OutboundRetryState {
  const outbound = thread.outbound.find((candidate) => candidate.id === outboundId)
  if (!outbound) return { kind: "refused", reason: "Unknown outbound message" }
  if (thread.outbound.some((candidate) => candidate.retryOf === outboundId)) {
    return { kind: "refused", reason: "This message was already retried" }
  }
  if (outbound.status === "pending") return { kind: "refused", reason: "This message is still being sent" }
  if (outbound.status === "sent") return { kind: "refused", reason: "This message was already sent" }
  return outbound.status === "unknown" ? { kind: "needs_confirm" } : { kind: "retryable" }
}

export function inboxReplyTextError(text: string): string | null {
  if (text.length === 0) return "Text is required"
  if (text.length > INBOX_REPLY_MAX_CHARS) return `Text must be at most ${INBOX_REPLY_MAX_CHARS} characters`
  return null
}

export function threadSentByAgent(thread: Pick<InboxThread, "outbound">): boolean {
  return thread.outbound.some((outbound) => outbound.by === "agent")
}

export function inboxThreadMatchesFilter(thread: InboxThread, filter: InboxFilter): boolean {
  if (filter.sourceKind !== undefined && thread.sourceKind !== filter.sourceKind) return false
  if (filter.projectId !== undefined) return false
  if (filter.chatId !== undefined && thread.chatId !== filter.chatId) return false
  if (filter.attentionOnly === true && thread.state !== "needs_you" && thread.state !== "new") return false
  if (filter.sentByAgent === true && !threadSentByAgent(thread)) return false
  return true
}

export function inboxItemMatchesFilter(item: InboxActivityItem, filter: InboxFilter): boolean {
  if (filter.sentByAgent === true) return false
  if (filter.sourceKind !== undefined && item.source.kind !== filter.sourceKind) return false
  if (filter.projectId !== undefined && item.projectId !== filter.projectId) return false
  if (filter.chatId !== undefined && item.chatId !== filter.chatId) return false
  if (filter.attentionOnly === true && !item.attention) return false
  return true
}
