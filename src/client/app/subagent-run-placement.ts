import type { HydratedTranscriptMessage, SubagentRunSummary } from "../../shared/types"
import { log } from "../../shared/log"

export const DELEGATE_SUBAGENT_TOOL_NAME = "mcp__kanna__delegate_subagent"

export interface DelegateCall {
  toolId: string
  subagentId: string
}

export interface RunPlacement {
  matched: Map<string, SubagentRunSummary>
  orphans: SubagentRunSummary[]
}

export function extractDelegateCalls(messages: HydratedTranscriptMessage[]): DelegateCall[] {
  const calls: DelegateCall[] = []
  for (const message of messages) {
    if (message.kind !== "tool") continue
    if (message.toolKind !== "mcp_generic") continue
    if (message.toolName !== DELEGATE_SUBAGENT_TOOL_NAME) continue
    const subagentId = message.input.payload.subagent_id
    if (typeof subagentId !== "string") continue
    calls.push({ toolId: message.toolId, subagentId })
  }
  return calls
}

export function matchRunsToDelegateCalls(
  delegateCalls: DelegateCall[],
  topLevelRuns: SubagentRunSummary[],
): RunPlacement {
  const runsBySubagent = new Map<string, SubagentRunSummary[]>()
  for (const run of topLevelRuns) {
    if (run.subagentId === null) continue
    const list = runsBySubagent.get(run.subagentId) ?? []
    list.push(run)
    runsBySubagent.set(run.subagentId, list)
  }
  for (const list of runsBySubagent.values()) {
    list.sort((a, b) => a.startedAt - b.startedAt || a.runId.localeCompare(b.runId))
  }

  const matched = new Map<string, SubagentRunSummary>()
  const claimed = new Set<string>()
  const cursorBySubagent = new Map<string, number>()
  for (const call of delegateCalls) {
    const list = runsBySubagent.get(call.subagentId)
    if (!list) continue
    const cursor = cursorBySubagent.get(call.subagentId) ?? 0
    const run = list[cursor]
    if (!run) continue
    matched.set(call.toolId, run)
    claimed.add(run.runId)
    cursorBySubagent.set(call.subagentId, cursor + 1)
  }

  const orphans = topLevelRuns.filter((run) => !claimed.has(run.runId))
  return { matched, orphans }
}

export function reportOrphanRuns(orphans: SubagentRunSummary[], isDev: boolean): void {
  if (orphans.length === 0) return
  const detail = orphans.map((run) => `${run.runId} (subagentId=${run.subagentId})`).join(", ")
  const message = `Subagent run placement: ${orphans.length} orphan top-level run(s) with no delegate_subagent tool call: ${detail}`
  if (isDev) {
    throw new Error(message)
  }
  log.error(message)
}
