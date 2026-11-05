import type { JsonValue } from "../../shared/json"
import { quickPromptLabel } from "../../shared/inbox/quick-prompts"
import type {
  InboundMessage,
  InboxActivityItem,
  InboxDraft,
  InboxOutboundMessage,
  InboxSourceKind,
  InboxThread,
  InboxThreadState,
  InboxVerdict,
} from "../../shared/inbox/types"
import type { McpSource } from "../../shared/mcp-sources/types"
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

export function isAgentReading(thread: Pick<InboxThread, "pendingScheduleId">): boolean {
  return thread.pendingScheduleId !== undefined
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

export function newestOutbound(thread: InboxThread): InboxOutboundMessage | undefined {
  return thread.outbound[thread.outbound.length - 1]
}

export function threadPreview(thread: InboxThread): string {
  const lastInbound = thread.messages[thread.messages.length - 1]
  const lastOutbound = newestOutbound(thread)
  if (lastOutbound !== undefined && lastOutbound.ts > (lastInbound?.ts ?? 0)) return `You: ${lastOutbound.text}`
  const summary = thread.report?.summary.trim() ?? ""
  if (summary.length > 0) return summary
  return lastInbound?.preview ?? ""
}

export type InboxThreadEntry =
  | { kind: "inbound"; ts: number; message: InboundMessage }
  | { kind: "outbound"; ts: number; outbound: InboxOutboundMessage }

export function threadEntries(thread: InboxThread): InboxThreadEntry[] {
  const inbound = thread.messages.map((message): InboxThreadEntry => ({ kind: "inbound", ts: message.ts, message }))
  const outbound = thread.outbound.map((entry): InboxThreadEntry => ({ kind: "outbound", ts: entry.ts, outbound: entry }))
  return [...inbound, ...outbound].sort((a, b) => a.ts - b.ts)
}

const OUTBOUND_STATUS_DISPLAY: Readonly<Record<Exclude<InboxOutboundMessage["status"], "failed">, InboxStateDisplay>> = {
  pending: { tone: "active", label: "Sending…" },
  sent: { tone: "muted", label: "Sent" },
  unknown: { tone: "attention", label: "Not confirmed" },
}

export function outboundStatusDisplay(outbound: InboxOutboundMessage): InboxStateDisplay {
  if (outbound.status !== "failed") return OUTBOUND_STATUS_DISPLAY[outbound.status]
  return { tone: "destructive", label: outbound.error ? `Failed: ${outbound.error}` : "Failed" }
}

export type InboxReplyMode = "direct" | "agent" | "none"

export function inboxReplyMode(thread: InboxThread, sources: readonly McpSource[]): InboxReplyMode {
  if (thread.sourceKind === "mcp" && sources.some((source) => source.id === thread.sourceId && source.reply !== null)) {
    return "direct"
  }
  return thread.chatId === undefined ? "none" : "agent"
}

export function fencedJson(payload: JsonValue): string {
  const body = JSON.stringify(payload, null, 2) ?? "null"
  const longestRun = Math.max(2, ...(body.match(/`+/g) ?? []).map((run) => run.length))
  const fence = "`".repeat(longestRun + 1)
  return `${fence}json\n${body}\n${fence}`
}

export const NO_CHAT_REPLY_REASON = "This source has no reply tool and no chat is handling it, so there is nobody to reply through."

export const ASK_NEEDS_CHAT_REASON = "Ask agent needs a source that runs in a chat (Run in chat or New chat)"

export function inboxAskBlockedReason(thread: Pick<InboxThread, "chatId" | "state">): string | null {
  if (thread.chatId === undefined) return ASK_NEEDS_CHAT_REASON
  return thread.state === "archived" ? "This thread is archived" : null
}

const CHIP_INSTRUCTION_MAX_CHARS = 24

export function draftChipLabel(draft: InboxDraft, version: number): string {
  if (draft.origin === "triage") return `v${version} · triage`
  const instruction = draft.instruction ?? ""
  const named = quickPromptLabel(instruction)
  if (named !== undefined) return `v${version} · ask: ${named}`
  if (instruction.length === 0) return `v${version} · ask`
  const short = instruction.length > CHIP_INSTRUCTION_MAX_CHARS ? `${instruction.slice(0, CHIP_INSTRUCTION_MAX_CHARS)}…` : instruction
  return `v${version} · ask: ${short}`
}
