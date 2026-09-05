import type { WorkflowAgentProgress, WorkflowPhase } from "../../shared/workflow-types"

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
  phases.forEach((p, i) => {
    const idx = i + 1
    groups.push({ key: `phase-${idx}`, phaseIndex: idx, title: p.title, detail: p.detail, agents: byPhase.get(idx) ?? [] })
    byPhase.delete(idx)
  })
  for (const idx of [...byPhase.keys()].sort((a, b) => a - b)) {
    const list = byPhase.get(idx)!
    groups.push({ key: `phase-${idx}`, phaseIndex: idx, title: list[0]?.phaseTitle ?? `Phase ${idx}`, agents: list })
  }
  if (ungrouped.length > 0) {
    groups.push({ key: "ungrouped", phaseIndex: null, title: UNGROUPED_TITLE, agents: ungrouped })
  }
  return groups
}
