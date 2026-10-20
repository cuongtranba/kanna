import type { BusEnvelope } from "../service-bus/envelope"
import { isJsonObject } from "../json"
import type { InboxActivityItem, InboxThread } from "./types"

export const ATTENTION_SUBJECTS: ReadonlySet<string> = new Set([
  "kanna.turn.failed",
  "kanna.toolRequest.put",
  "kanna.cron.runOutcome",
  "kanna.subagent.failed",
  "kanna.loop.runOutcome",
])

const OUTCOME_SUBJECTS: ReadonlySet<string> = new Set(["kanna.cron.runOutcome", "kanna.loop.runOutcome"])

export function isAttention(envelope: Pick<BusEnvelope, "subject" | "payload">): boolean {
  if (!ATTENTION_SUBJECTS.has(envelope.subject)) return false
  if (!OUTCOME_SUBJECTS.has(envelope.subject)) return true
  return isJsonObject(envelope.payload) && envelope.payload.ok === false
}

export function inboxTab(entry: InboxThread | InboxActivityItem): boolean {
  if ("messages" in entry) return entry.state === "new" || entry.state === "needs_you" || entry.state === "fyi"
  return entry.attention
}

export function raisesNotification(thread: Pick<InboxThread, "state">): boolean {
  return thread.state === "needs_you"
}
