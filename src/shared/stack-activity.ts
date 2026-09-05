
import type { ChatActivity } from "./types"

export interface StackActivity {
  activeChats: number
  agents: number
  loops: number
  workflows: number
  backgroundTasks: number
  awaitingAnswer: number
  failing: number
}

export const EMPTY_STACK_ACTIVITY: StackActivity = {
  activeChats: 0,
  agents: 0,
  loops: 0,
  workflows: 0,
  backgroundTasks: 0,
  awaitingAnswer: 0,
  failing: 0,
}

function isActive(a: ChatActivity): boolean {
  return a.agents > 0
    || a.loop !== null
    || a.workflow !== null
    || a.backgroundTasks > 0
    || a.awaitingAnswer
    || a.lastRunFailure !== null
}

export function aggregateStackActivity(activities: readonly ChatActivity[]): StackActivity {
  const total = { ...EMPTY_STACK_ACTIVITY }
  for (const a of activities) {
    if (!isActive(a)) continue
    total.activeChats += 1
    total.agents += a.agents
    if (a.loop !== null) total.loops += 1
    if (a.workflow !== null) total.workflows += 1
    total.backgroundTasks += a.backgroundTasks
    if (a.awaitingAnswer) total.awaitingAnswer += 1
    if (a.lastRunFailure !== null) total.failing += 1
  }
  return total
}

export function formatStackActivity(activity: StackActivity): string | null {
  if (activity.activeChats === 0) return null
  const parts: string[] = []
  if (activity.awaitingAnswer > 0) parts.push(`${activity.awaitingAnswer} awaiting`)
  if (activity.failing > 0) parts.push(`${activity.failing} failing`)
  if (activity.agents > 0) parts.push(`${activity.agents} agent${activity.agents === 1 ? "" : "s"}`)
  if (activity.loops > 0) parts.push(`${activity.loops} loop${activity.loops === 1 ? "" : "s"}`)
  if (activity.workflows > 0) parts.push(`${activity.workflows} workflow${activity.workflows === 1 ? "" : "s"}`)
  if (activity.backgroundTasks > 0) parts.push(`${activity.backgroundTasks} task${activity.backgroundTasks === 1 ? "" : "s"}`)
  if (parts.length === 0) return `${activity.activeChats} active`
  return parts.join(", ")
}
