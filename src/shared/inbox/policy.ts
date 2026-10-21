import type { BusEnvelope } from "../service-bus/envelope"
import { isJsonObject, type JsonValue } from "../json"
import type { InboxActivityItem, InboxThread } from "./types"

export const ATTENTION_SUBJECTS: ReadonlySet<string> = new Set([
  "kanna.turn.failed",
  "kanna.toolRequest.put",
  "kanna.cron.runOutcome",
  "kanna.subagent.failed",
  "kanna.loop.runOutcome",
])

const OUTCOME_SUBJECTS: ReadonlySet<string> = new Set(["kanna.cron.runOutcome", "kanna.loop.runOutcome"])

const TOOL_REQUEST_PUT = "kanna.toolRequest.put"
const TOOL_REQUEST_RESOLVED = "kanna.toolRequest.resolved"

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
  if ("messages" in entry) return entry.state === "new" || entry.state === "needs_you" || entry.state === "fyi"
  return entry.attention
}

export function raisesNotification(thread: Pick<InboxThread, "state">): boolean {
  return thread.state === "needs_you"
}
