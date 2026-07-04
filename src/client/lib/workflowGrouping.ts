import type { WorkflowAgentProgress, WorkflowPhase } from "../../shared/workflow-types"

/**
 * A phase box in the workflow progress tree, mirroring the claude-code terminal
 * `/workflows` view where agents are nested under their phase. `phaseIndex` is
 * 1-based (matching the sidecar `workflow_agent.phaseIndex`); `null` marks the
 * trailing "ungrouped" box for agents that carry no phase.
 */
export interface WorkflowPhaseGroup {
  key: string
  phaseIndex: number | null
  title: string
  detail?: string
  agents: WorkflowAgentProgress[]
}

const UNGROUPED_TITLE = "Agents"

function hasPhase(a: WorkflowAgentProgress): boolean {
  return typeof a.phaseIndex === "number" && a.phaseIndex >= 1
}

/**
 * Group a run's agents under their declared phases for the progress tree.
 *
 * - When NO agent carries a phase (a live run before the sidecar lands, or a
 *   flat workflow), returns a single "Agents" box with every agent — no empty
 *   phase boxes.
 * - When at least one agent is phased, returns the declared phases IN ORDER
 *   (kept even if empty, so upcoming phases show as boxes like the terminal),
 *   followed by any phase index an agent references but the run never declared,
 *   then a trailing "Agents" box for agents with no phase.
 *
 * Agent order within a box is preserved from the input (already index-ordered).
 */
export function groupWorkflowAgentsByPhase(
  phases: WorkflowPhase[],
  agents: WorkflowAgentProgress[],
): WorkflowPhaseGroup[] {
  if (!agents.some(hasPhase)) {
    return agents.length === 0
      ? []
      : [{ key: "ungrouped", phaseIndex: null, title: UNGROUPED_TITLE, agents }]
  }

  const byPhase = new Map<number, WorkflowAgentProgress[]>()
  const ungrouped: WorkflowAgentProgress[] = []
  for (const a of agents) {
    if (hasPhase(a)) {
      const arr = byPhase.get(a.phaseIndex!) ?? []
      arr.push(a)
      byPhase.set(a.phaseIndex!, arr)
    } else {
      ungrouped.push(a)
    }
  }

  const groups: WorkflowPhaseGroup[] = []
  // Declared phases, in declared order (1-based index = position + 1).
  phases.forEach((p, i) => {
    const idx = i + 1
    groups.push({ key: `phase-${idx}`, phaseIndex: idx, title: p.title, detail: p.detail, agents: byPhase.get(idx) ?? [] })
    byPhase.delete(idx)
  })
  // Phase indices an agent references but the run never declared (defensive).
  for (const idx of [...byPhase.keys()].sort((a, b) => a - b)) {
    const list = byPhase.get(idx)!
    groups.push({ key: `phase-${idx}`, phaseIndex: idx, title: list[0]?.phaseTitle ?? `Phase ${idx}`, agents: list })
  }
  if (ungrouped.length > 0) {
    groups.push({ key: "ungrouped", phaseIndex: null, title: UNGROUPED_TITLE, agents: ungrouped })
  }
  return groups
}
