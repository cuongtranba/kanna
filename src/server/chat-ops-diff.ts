/**
 * Pure diff of the light (non-transcript) parts of a chat snapshot into
 * `ChatOp`s, keyed off last-sent JSON signatures. Fed by a meta snapshot
 * derived with recentLimit=0 — its `messages` contain only the synthetic
 * pending_tool_request rows, and transcript appends flow through the
 * op-log separately.
 */
import type { ChatOp, ChatSections } from "../shared/chat-ops"
import type { ChatSnapshot } from "../shared/types"

// keyof-typed so adding a ChatSections key without updating this list fails
// the exhaustiveness check below.
const SECTION_KEYS = [
  "queuedMessages",
  "availableProviders",
  "slashCommands",
  "slashCommandsLoading",
  "schedules",
  "liveScheduleId",
  "tunnels",
  "liveTunnelId",
  "resolvedBindings",
  "subagentRuns",
  "loopProgress",
] as const satisfies readonly (keyof ChatSections)[]

type SectionKey = (typeof SECTION_KEYS)[number]
type MissingSectionKeys = Exclude<keyof ChatSections, SectionKey>
// Compile-time exhaustiveness: errors if ChatSections gains a key not listed.
const _exhaustive: MissingSectionKeys extends never ? true : never = true
void _exhaustive

export interface ChatMetaSignatures {
  runtime: string
  pending: string
  sections: Record<SectionKey, string>
}

function runtimeSignature(meta: ChatSnapshot): string {
  // timings churn every derive (wall-clock); they never trigger a delta on
  // their own — same rule as the broadcast snapshot signature.
  return JSON.stringify({ ...meta.runtime, timings: null })
}

export function diffChatMeta(
  prev: ChatMetaSignatures | undefined,
  meta: ChatSnapshot,
): { ops: ChatOp[]; next: ChatMetaSignatures } {
  const sections = {} as Record<SectionKey, string>
  for (const key of SECTION_KEYS) {
    sections[key] = JSON.stringify(meta[key] ?? null)
  }
  const next: ChatMetaSignatures = {
    runtime: runtimeSignature(meta),
    pending: JSON.stringify(meta.messages),
    sections,
  }

  if (!prev) {
    return { ops: [], next }
  }

  const ops: ChatOp[] = []
  if (prev.runtime !== next.runtime) {
    ops.push({ kind: "runtime.set", runtime: meta.runtime })
  }
  const changedSections: Partial<ChatSections> = {}
  let sectionChanged = false
  for (const key of SECTION_KEYS) {
    if (prev.sections[key] !== next.sections[key]) {
      // Partial<ChatSections> assignment via a keyed copy keeps types exact.
      Object.assign(changedSections, { [key]: meta[key] })
      sectionChanged = true
    }
  }
  if (sectionChanged) {
    ops.push({ kind: "sections.set", sections: changedSections })
  }
  if (prev.pending !== next.pending) {
    ops.push({ kind: "pending.set", entries: meta.messages })
  }
  return { ops, next }
}
