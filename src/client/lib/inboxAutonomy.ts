import {
  autonomyNeedsReplyTarget,
  INBOX_AUTONOMY_LEVELS,
  providerAllowsAuto,
  type InboxAutonomyLevel,
} from "../../shared/inbox/autonomy"
import type { InboxOutboundMessage, InboxThread } from "../../shared/inbox/types"
import type { McpSource } from "../../shared/mcp-sources/types"

export const INBOX_AUTONOMY_LEVEL_LABEL: Readonly<Record<InboxAutonomyLevel, string>> = {
  off: "Off",
  suggest: "Suggest",
  approve: "Approve",
  auto: "Auto",
}

export const SOURCE_DEFAULT_VALUE = "default"

export const AUTO_NEEDS_REPLY_REASON = "Approve and Auto need a reply target on the source"
export const AUTO_NEEDS_CLAUDE_REASON = "Auto needs a Claude handler: Codex cannot be stopped from sending on its own"

export interface InboxAutonomyOption {
  value: string
  label: string
  disabled: boolean
}

export interface InboxAutonomyView {
  sourceId: string
  sourceLevel: InboxAutonomyLevel
  effective: InboxAutonomyLevel
  blockedReason: string | null
  offerAllowContact: boolean
  allowlist: readonly string[]
  options: readonly InboxAutonomyOption[]
}

function levelBlockedReason(level: InboxAutonomyLevel, source: McpSource): string | null {
  if (autonomyNeedsReplyTarget(level) && source.reply === null) return AUTO_NEEDS_REPLY_REASON
  if (level === "auto" && !providerAllowsAuto(source.handler.provider)) return AUTO_NEEDS_CLAUDE_REASON
  return null
}

export function inboxAutonomyView(thread: InboxThread, sources: readonly McpSource[]): InboxAutonomyView | null {
  if (thread.sourceKind !== "mcp") return null
  const source = sources.find((candidate) => candidate.id === thread.sourceId)
  if (source === undefined) return null
  const sourceLevel = source.autonomy.level
  const effective = thread.autonomy ?? sourceLevel
  const blocked = INBOX_AUTONOMY_LEVELS.map((level) => ({ level, reason: levelBlockedReason(level, source) }))
  return {
    sourceId: source.id,
    sourceLevel,
    effective,
    blockedReason: blocked.find((entry) => entry.reason !== null)?.reason ?? null,
    offerAllowContact: effective === "auto" && !source.autonomy.allowlist.includes(thread.threadKey),
    allowlist: source.autonomy.allowlist,
    options: [
      { value: SOURCE_DEFAULT_VALUE, label: `Source default (${INBOX_AUTONOMY_LEVEL_LABEL[sourceLevel]})`, disabled: false },
      ...blocked.map(({ level, reason }) => ({ value: level, label: INBOX_AUTONOMY_LEVEL_LABEL[level], disabled: reason !== null })),
    ],
  }
}

export function isAgentPaused(thread: Pick<InboxThread, "agentPausedUntil">, now: number): boolean {
  return thread.agentPausedUntil !== undefined && thread.agentPausedUntil > now
}

export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, "0")
  return `${String(minutes)}:${seconds}`
}

export function confidencePercent(confidence: number): string {
  return `${String(Math.round(confidence * 100))}%`
}

const OUTBOUND_AUTHOR_LABEL: Readonly<Record<InboxOutboundMessage["by"], string>> = {
  you: "You",
  approved: "You · approved",
  agent: "Agent · auto",
}

export function outboundAuthorLabel(outbound: Pick<InboxOutboundMessage, "by">): string {
  return OUTBOUND_AUTHOR_LABEL[outbound.by]
}

export function outboundProvenanceHint(outbound: Pick<InboxOutboundMessage, "proposal">): string | null {
  const { proposal } = outbound
  if (proposal === undefined) return null
  return `Confidence ${confidencePercent(proposal.confidence)} · ${proposal.reason}`
}
