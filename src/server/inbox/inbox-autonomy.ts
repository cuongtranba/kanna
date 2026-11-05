import type { InboxAutonomyLevel } from "../../shared/inbox/autonomy"
import type { InboxOutboundMessage } from "../../shared/inbox/types"

export interface ProposalDecisionInput {
  level: InboxAutonomyLevel
  providerAllowsAuto: boolean
  paused: boolean
  allowlisted: boolean
  confidence: number
  threshold: number
  sentLastHourThread: number
  perThreadPerHour: number
  sentTodaySource: number
  perSourcePerDay: number
  inQuietHours: boolean
  textViolations: readonly string[]
}

export type ProposalDecision =
  | { kind: "draft" }
  | { kind: "approval"; blockedBy?: string }
  | { kind: "auto" }

function percent(value: number): string {
  return `${String(Math.round(value * 100))}%`
}

function firstBlockingGuardrail(input: ProposalDecisionInput): string | null {
  if (!input.providerAllowsAuto) return "Auto-send is not available for this source's handler"
  if (!input.allowlisted) return "This contact is not on the auto-send allowlist"
  if (input.confidence < input.threshold) {
    return `Confidence ${percent(input.confidence)} is below the ${percent(input.threshold)} threshold`
  }
  if (input.sentLastHourThread >= input.perThreadPerHour) {
    return `Hourly limit of ${String(input.perThreadPerHour)} auto-sends for this thread reached`
  }
  if (input.sentTodaySource >= input.perSourcePerDay) {
    return `Daily limit of ${String(input.perSourcePerDay)} auto-sends for this source reached`
  }
  if (input.inQuietHours) return "Quiet hours are active"
  if (input.textViolations.length > 0) return `The reply ${input.textViolations.join(" and ")}`
  return null
}

export function decideProposal(input: ProposalDecisionInput): ProposalDecision {
  if (input.paused) return { kind: "draft" }
  switch (input.level) {
    case "off":
    case "suggest":
      return { kind: "draft" }
    case "approve":
      return { kind: "approval" }
    case "auto": {
      const blockedBy = firstBlockingGuardrail(input)
      return blockedBy === null ? { kind: "auto" } : { kind: "approval", blockedBy }
    }
  }
}

export function agentSendsSince(outbound: readonly InboxOutboundMessage[], since: number): number {
  return outbound.filter((entry) => entry.by === "agent" && entry.ts >= since && (entry.status === "sent" || entry.status === "pending")).length
}
