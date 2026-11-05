import type { ChatOp, ChatSections, SubagentRunMeta } from "../shared/chat-ops"
import type { ChatSnapshot, SubagentRunStatus, SubagentRunSummary } from "../shared/types"

export const SECTION_KEYS = [
  "queuedMessages",
  "availableProviders",
  "schedules",
  "liveScheduleId",
  "tunnels",
  "liveTunnelId",
  "resolvedBindings",
  "loopProgress",
  "cronJobs",
] as const satisfies readonly (keyof ChatSections)[]

type SectionKey = (typeof SECTION_KEYS)[number]
type MissingSectionKeys = Exclude<keyof ChatSections, SectionKey>
const _exhaustive: MissingSectionKeys extends never ? true : never = true
void _exhaustive

function buildSectionSignatures(meta: ChatSnapshot): Record<SectionKey, string> {
  return {
    queuedMessages: JSON.stringify(meta.queuedMessages),
    availableProviders: JSON.stringify(meta.availableProviders),
    schedules: JSON.stringify(meta.schedules),
    liveScheduleId: JSON.stringify(meta.liveScheduleId),
    tunnels: JSON.stringify(meta.tunnels),
    liveTunnelId: JSON.stringify(meta.liveTunnelId),
    resolvedBindings: JSON.stringify(meta.resolvedBindings ?? null),
    loopProgress: JSON.stringify(meta.loopProgress),
    cronJobs: JSON.stringify(meta.cronJobs),
  }
}

interface SubagentRunSignature {
  meta: string
  textLength: number | null
  status: SubagentRunStatus
}

export interface ChatMetaSignatures {
  runtime: string
  pending: string
  sections: Record<SectionKey, string>
  subagentRuns: Record<string, SubagentRunSignature>
}

function buildSubagentRunSignatures(runs: ChatSnapshot["subagentRuns"]): Record<string, SubagentRunSignature> {
  return Object.fromEntries(
    Object.entries(runs).map(([runId, run]) => [
      runId,
      {
        meta: JSON.stringify({ ...run, finalText: null, recentEntries: run.recentEntries.slice(-1).map((entry) => entry._id) }),
        textLength: run.finalText === null ? null : run.finalText.length,
        status: run.status,
      },
    ]),
  )
}

function subagentRunMeta({ finalText: _finalText, ...meta }: SubagentRunSummary): SubagentRunMeta {
  return meta
}

function diffSubagentRuns(
  prev: Record<string, SubagentRunSignature>,
  next: Record<string, SubagentRunSignature>,
  runs: ChatSnapshot["subagentRuns"],
): ChatOp[] {
  const ops: ChatOp[] = []
  for (const runId of Object.keys(prev)) {
    if (!(runId in next)) ops.push({ kind: "subagentRun.remove", runId })
  }
  for (const [runId, run] of Object.entries(runs)) {
    const before = prev[runId]
    const after = next[runId]
    if (!after) continue
    if (!before || before.meta !== after.meta) ops.push({ kind: "subagentRun.upsert", run: subagentRunMeta(run) })
    if (run.finalText === null) continue
    const knownLength = before?.textLength ?? 0
    if (before && before.textLength === after.textLength && before.status === after.status) continue
    if (before?.status === "running" && run.status === "running" && run.finalText.length > knownLength) {
      ops.push({ kind: "subagentRun.text", runId, text: run.finalText.slice(knownLength), mode: "append" })
    } else {
      ops.push({ kind: "subagentRun.text", runId, text: run.finalText, mode: "replace" })
    }
  }
  return ops
}

function runtimeSignature(meta: ChatSnapshot): string {
  return JSON.stringify({ ...meta.runtime, timings: null })
}

export function diffChatMeta(
  prev: ChatMetaSignatures | undefined,
  meta: ChatSnapshot,
): { ops: ChatOp[]; next: ChatMetaSignatures } {
  const next: ChatMetaSignatures = {
    runtime: runtimeSignature(meta),
    pending: JSON.stringify(meta.messages),
    sections: buildSectionSignatures(meta),
    subagentRuns: buildSubagentRunSignatures(meta.subagentRuns),
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
      Object.assign(changedSections, { [key]: meta[key] })
      sectionChanged = true
    }
  }
  if (sectionChanged) {
    ops.push({ kind: "sections.set", sections: changedSections })
  }
  ops.push(...diffSubagentRuns(prev.subagentRuns, next.subagentRuns, meta.subagentRuns))
  if (prev.pending !== next.pending) {
    ops.push({ kind: "pending.set", entries: meta.messages })
  }
  return { ops, next }
}
