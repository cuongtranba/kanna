import type { JsonValue } from "../../shared/json"
import type { InboxActivityItem, InboxSourceKind, InboxThread, InboxThreadState, InboxVerdict } from "../../shared/inbox/types"
import type { BusSource } from "../../shared/service-bus/envelope"
import type { StatusTone } from "./statusLabel"
import { namedBusSubject, subjectFamily } from "../../shared/service-bus/subjects"

export interface InboxStateDisplay {
  tone: StatusTone
  label: string
}

const THREAD_STATE_DISPLAY: Readonly<Record<InboxThreadState, InboxStateDisplay>> = {
  new: { tone: "attention", label: "Needs you" },
  needs_you: { tone: "attention", label: "Needs you" },
  fyi: { tone: "muted", label: "FYI" },
  handled: { tone: "muted", label: "Handled" },
  replied: { tone: "muted", label: "Replied" },
  archived: { tone: "muted", label: "Archived" },
}

const AGENT_READING: InboxStateDisplay = { tone: "active", label: "Agent reading" }

export function isAgentReading(thread: Pick<InboxThread, "pendingScheduleId" | "report">): boolean {
  return thread.pendingScheduleId !== undefined && thread.report === undefined
}

export function threadStateDisplay(thread: InboxThread): InboxStateDisplay {
  if (isAgentReading(thread)) return AGENT_READING
  return THREAD_STATE_DISPLAY[thread.state]
}

const FAILED_SUBJECTS: ReadonlySet<string> = new Set([namedBusSubject("turnFailed"), namedBusSubject("subagentFailed")])

export function isFailedActivity(item: Pick<InboxActivityItem, "subject" | "title">): boolean {
  return FAILED_SUBJECTS.has(item.subject) || item.title.endsWith(" failed")
}

export function itemStateDisplay(item: InboxActivityItem): InboxStateDisplay {
  if (isFailedActivity(item)) return { tone: "destructive", label: "Failed" }
  if (item.attention) return { tone: "attention", label: "Needs you" }
  return { tone: "muted", label: "Activity" }
}

const SUBJECT_LABEL: Readonly<Record<string, string>> = {
  turn: "Turn",
  chat: "Chat",
  project: "Project",
  subagent: "Subagent",
  toolRequest: "Tool approval",
  cron: "Cron",
  loop: "Loop",
}

export function subjectLabel(subject: string): string {
  const family = subjectFamily(subject)
  return SUBJECT_LABEL[family] ?? (family.length > 0 ? family : subject)
}

export function sourceKindLabel(kind: BusSource["kind"] | InboxSourceKind): string {
  switch (kind) {
    case "webhook": return "Webhook"
    case "mcp": return "MCP"
    case "transcript": return "Transcript"
    case "inbox": return "Inbox"
    case "store": return "Kanna"
  }
}

export function itemSourceName(source: BusSource): string {
  switch (source.kind) {
    case "webhook": return source.hookName
    case "mcp": return source.sourceName
    default: return sourceKindLabel(source.kind)
  }
}

export const INBOX_SOURCE_FILTERS: readonly { kind: BusSource["kind"]; label: string }[] = [
  { kind: "webhook", label: "Webhook" },
  { kind: "mcp", label: "MCP" },
  { kind: "store", label: "Kanna" },
  { kind: "transcript", label: "Transcript" },
]

export function formatUnreadBadge(count: number): string {
  return count > 99 ? "99+" : String(count)
}

const VERDICT_DISPLAY: Readonly<Record<InboxVerdict, InboxStateDisplay>> = {
  needs_you: { tone: "attention", label: "Needs you" },
  fyi: { tone: "muted", label: "FYI" },
  handled: { tone: "muted", label: "Handled" },
}

export function verdictDisplay(verdict: InboxVerdict): InboxStateDisplay {
  return VERDICT_DISPLAY[verdict]
}

export const EMPTY_SUMMARY_TEXT = "The agent ended its turn without a summary."

export function reportSummaryText(summary: string): string {
  return summary.trim().length > 0 ? summary : EMPTY_SUMMARY_TEXT
}

export function threadPreview(thread: InboxThread): string {
  const summary = thread.report?.summary.trim() ?? ""
  if (summary.length > 0) return summary
  return thread.messages[thread.messages.length - 1]?.preview ?? ""
}

export function fencedJson(payload: JsonValue): string {
  const body = JSON.stringify(payload, null, 2) ?? "null"
  const longestRun = Math.max(2, ...(body.match(/`+/g) ?? []).map((run) => run.length))
  const fence = "`".repeat(longestRun + 1)
  return `${fence}json\n${body}\n${fence}`
}

export const NO_CHAT_REPLY_REASON = "No chat is handling this source, so there is nobody to reply through."
