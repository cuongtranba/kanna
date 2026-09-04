/**
 * "What is running across this stack right now?"
 *
 * `ChatActivity` is already computed per chat and every stack chat carries its
 * `stackId`, so the rollup is a fold — no new events, no new state. It exists
 * because a stack's own row is the only place the question can be asked: the
 * member chats may be scattered across several collapsed project groups.
 *
 * Pure, and deliberately COUNTS rather than re-describing: a stack row has one
 * line of space, so "3 agents, 1 loop" is the useful answer and the per-chat
 * detail stays on the chat rows.
 */

import type { ChatActivity } from "./types"

export interface StackActivity {
  /** Member chats with anything happening at all. Drives whether to render. */
  activeChats: number
  agents: number
  /** Member chats with an armed loop. */
  loops: number
  workflows: number
  backgroundTasks: number
  /** Member chats blocked on an AskUserQuestion — the only one the user must act on. */
  awaitingAnswer: number
  /** Member chats whose last subagent run failed. */
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

/** True when a chat contributes anything to its stack's rollup. */
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

/**
 * The rollup as a short label, or null when there is nothing to report.
 *
 * Ordered by what the user would act on first: a question blocks progress, a
 * failure needs a decision, and the rest is just work in flight.
 */
export function formatStackActivity(activity: StackActivity): string | null {
  if (activity.activeChats === 0) return null
  const parts: string[] = []
  if (activity.awaitingAnswer > 0) parts.push(`${activity.awaitingAnswer} awaiting`)
  if (activity.failing > 0) parts.push(`${activity.failing} failing`)
  if (activity.agents > 0) parts.push(`${activity.agents} agent${activity.agents === 1 ? "" : "s"}`)
  if (activity.loops > 0) parts.push(`${activity.loops} loop${activity.loops === 1 ? "" : "s"}`)
  if (activity.workflows > 0) parts.push(`${activity.workflows} workflow${activity.workflows === 1 ? "" : "s"}`)
  if (activity.backgroundTasks > 0) parts.push(`${activity.backgroundTasks} task${activity.backgroundTasks === 1 ? "" : "s"}`)
  // Every counted dimension was zero but a chat was still "active" — that
  // cannot happen given isActive, but returning the chat count beats "".
  if (parts.length === 0) return `${activity.activeChats} active`
  return parts.join(", ")
}
