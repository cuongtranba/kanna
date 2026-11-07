import type { AgentProvider } from "../../shared/core-types"
import { toError } from "../../shared/errors"
import {
  INBOX_TAKEOVER_PAUSE_MS,
  isWithinQuietHours,
  providerAllowsAuto,
  type McpSourceAutonomy,
} from "../../shared/inbox/autonomy"
import { outboundTextViolations } from "../../shared/inbox/outbound-text"
import type { InboxProposeSend, InboxProposal, InboxThread } from "../../shared/inbox/types"
import { log } from "../../shared/log"
import { agentSendsSince, decideProposal, type ProposalDecision } from "./inbox-autonomy"
import type { InboxOutbox, InboxSendResult } from "./inbox-outbox"
import type { InboxRegistry } from "./inbox-registry"

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export interface AutopilotClock {
  now(): number
  schedule(run: () => void, delayMs: number): () => void
}

export interface AutopilotSource {
  id: string
  hasReply: boolean
  autonomy: McpSourceAutonomy
  provider?: AgentProvider
}

export type AutopilotSourceResolver = (thread: InboxThread) => AutopilotSource | null

export type InboxProposalAck = { ok: true } | { ok: false; error: string }

export interface InboxAutopilot {
  propose(threadId: string, proposal: InboxProposeSend): Promise<void>
  approve(threadId: string, proposalId: string, text?: string): Promise<InboxSendResult>
  reject(threadId: string, proposalId: string): Promise<InboxProposalAck>
  cancel(threadId: string, proposalId: string): Promise<InboxProposalAck>
  takeOver(threadId: string): Promise<void>
}

export interface InboxAutopilotOptions {
  registry: Pick<
    InboxRegistry,
    "getThread" | "addProposal" | "resolveProposal" | "recordProposalDraft" | "agentSendCount" | "pauseAgent"
  >
  outbox: Pick<InboxOutbox, "send">
  resolveSource: AutopilotSourceResolver
  clock: AutopilotClock
  ids?: () => string
}

function currentProposal(thread: InboxThread | null, proposalId: string): InboxProposal | null {
  return thread?.proposal?.id === proposalId ? thread.proposal : null
}

function minuteOfDay(at: number): number {
  const date = new Date(at)
  return date.getHours() * 60 + date.getMinutes()
}

export function createInboxAutopilot(options: InboxAutopilotOptions): InboxAutopilot {
  const { registry, outbox, resolveSource, clock } = options
  const newId = options.ids ?? (() => crypto.randomUUID())
  const timers = new Map<string, () => void>()
  const claimed = new Set<string>()

  function claim(proposalId: string): boolean {
    if (claimed.has(proposalId)) return false
    claimed.add(proposalId)
    return true
  }

  function disarm(proposalId: string): void {
    timers.get(proposalId)?.()
    timers.delete(proposalId)
  }

  function isPaused(thread: InboxThread): boolean {
    return thread.muted || (thread.agentPausedUntil !== undefined && thread.agentPausedUntil > clock.now())
  }

  function decide(thread: InboxThread, source: AutopilotSource, proposal: InboxProposeSend): ProposalDecision {
    const { autonomy } = source
    const now = clock.now()
    return decideProposal({
      level: thread.autonomy ?? autonomy.level,
      providerAllowsAuto: providerAllowsAuto(source.provider),
      paused: isPaused(thread),
      allowlisted: autonomy.allowlist.includes(thread.threadKey),
      confidence: proposal.confidence,
      threshold: autonomy.threshold,
      sentLastHourThread: agentSendsSince(thread.outbound, now - HOUR_MS),
      perThreadPerHour: autonomy.perThreadPerHour,
      sentTodaySource: registry.agentSendCount(source.id, now - DAY_MS),
      perSourcePerDay: autonomy.perSourcePerDay,
      inQuietHours: isWithinQuietHours(autonomy.quietHours, minuteOfDay(now)),
      textViolations: outboundTextViolations(proposal.text, autonomy),
    })
  }

  async function fire(threadId: string, proposalId: string): Promise<void> {
    timers.delete(proposalId)
    if (!claim(proposalId)) return
    try {
      const thread = registry.getThread(threadId)
      const proposal = currentProposal(thread, proposalId)
      if (thread === null || proposal === null || proposal.status !== "scheduled") return
      if (isPaused(thread)) {
        await registry.resolveProposal(threadId, proposalId, "expired")
        return
      }
      const sent = await outbox.send(threadId, proposal.text, "agent", {
        id: proposal.id,
        confidence: proposal.confidence,
        reason: proposal.reason,
      })
      await registry.resolveProposal(threadId, proposalId, sent.ok ? "sent" : "expired", sent.ok ? sent.outboundId : undefined)
    } finally {
      claimed.delete(proposalId)
    }
  }

  function arm(threadId: string, proposalId: string, delayMs: number): void {
    timers.set(proposalId, clock.schedule(() => {
      fire(threadId, proposalId).catch((error) => {
        log.warn("[inbox-autopilot] fire failed:", toError(error))
      })
    }, delayMs))
  }

  async function expirePrevious(thread: InboxThread): Promise<void> {
    if (thread.proposal === undefined) return
    disarm(thread.proposal.id)
    await registry.resolveProposal(thread.id, thread.proposal.id, "expired")
  }

  async function propose(threadId: string, input: InboxProposeSend): Promise<void> {
    const thread = registry.getThread(threadId)
    if (thread === null) return
    const source = resolveSource(thread)
    const decision: ProposalDecision = source === null || !source.hasReply ? { kind: "draft" } : decide(thread, source, input)
    if (decision.kind === "draft") {
      await expirePrevious(thread)
      if (thread.drafts.at(-1)?.text !== input.text) await registry.recordProposalDraft(threadId, input.text)
      return
    }
    const at = clock.now()
    const base = { id: newId(), text: input.text, confidence: input.confidence, reason: input.reason, at }
    if (thread.proposal !== undefined) disarm(thread.proposal.id)
    if (decision.kind === "approval") {
      await registry.addProposal(threadId, {
        ...base,
        status: "open",
        ...(decision.blockedBy === undefined ? {} : { blockedBy: decision.blockedBy }),
      })
      return
    }
    const delayMs = (source?.autonomy.sendDelaySeconds ?? 0) * 1000
    await registry.addProposal(threadId, { ...base, status: "scheduled", scheduledFor: at + delayMs })
    arm(threadId, base.id, delayMs)
  }

  async function approve(threadId: string, proposalId: string, text?: string): Promise<InboxSendResult> {
    const proposal = currentProposal(registry.getThread(threadId), proposalId)
    if (proposal === null || proposal.status !== "open") return { ok: false, error: "This proposal is no longer waiting for approval" }
    if (!claim(proposalId)) return { ok: false, error: "This proposal is already being handled" }
    try {
      const sent = await outbox.send(threadId, text ?? proposal.text, "approved", {
        id: proposal.id,
        confidence: proposal.confidence,
        reason: proposal.reason,
      })
      if (!sent.ok) return sent
      await registry.resolveProposal(threadId, proposalId, "sent", sent.outboundId)
      await registry.pauseAgent(threadId, clock.now() + INBOX_TAKEOVER_PAUSE_MS)
      return sent
    } finally {
      claimed.delete(proposalId)
    }
  }

  async function resolveByUser(
    threadId: string,
    proposalId: string,
    resolution: "rejected" | "cancelled",
  ): Promise<InboxProposalAck> {
    const proposal = currentProposal(registry.getThread(threadId), proposalId)
    const wanted = resolution === "cancelled" ? "scheduled" : "open"
    if (proposal === null || proposal.status !== wanted || !claim(proposalId)) {
      return { ok: false, error: "This proposal can no longer be changed" }
    }
    try {
      disarm(proposalId)
      await registry.resolveProposal(threadId, proposalId, resolution)
      return { ok: true }
    } finally {
      claimed.delete(proposalId)
    }
  }

  async function takeOver(threadId: string): Promise<void> {
    const proposal = registry.getThread(threadId)?.proposal
    if (proposal !== undefined) {
      await resolveByUser(threadId, proposal.id, proposal.status === "scheduled" ? "cancelled" : "rejected")
    }
    await registry.pauseAgent(threadId, clock.now() + INBOX_TAKEOVER_PAUSE_MS)
  }

  return {
    propose,
    approve,
    reject: (threadId, proposalId) => resolveByUser(threadId, proposalId, "rejected"),
    cancel: (threadId, proposalId) => resolveByUser(threadId, proposalId, "cancelled"),
    takeOver,
  }
}
