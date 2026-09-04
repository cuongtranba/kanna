/**
 * How the card drawer words things.
 *
 * Pure formatters, beside `cardFieldValue` and `boardChatFacts` for the same
 * reason: what the drawer SAYS is separable from what it renders, and the
 * sentences are worth reading on their own.
 */

import type { StartWorkResult } from "../../../shared/boards/start-work"
import type { CardActor } from "../../../shared/boards/types"
import type { ChatActivity } from "../../../shared/types"

/** Who wrote a comment, in the reader's terms rather than the store's. */
export function authorLabel(kind: CardActor["kind"]): string {
  switch (kind) {
    case "agent":
      return "Agent"
    case "sync":
      return "Sync"
    case "user":
      return "You"
  }
}

/**
 * What to say after the Start work button has run.
 *
 * Only the surprising outcomes get a line. Opening the chat is its own
 * feedback — the tab appears — and saying "Started" over it would be the UI
 * performing rather than explaining.
 */
export function describeStartWork(result: StartWorkResult): string | null {
  if (result.reused) return null
  if (result.movedToColumnId === null) return "Started · no column marked active"
  return null
}

/** The one line a linked chat adds about what it is currently doing. */
export function workDetailRows(activity: ChatActivity): readonly string[] {
  if (activity.agents > 0) return [`${activity.agents} agent${activity.agents === 1 ? "" : "s"}`]
  if (activity.workflow) return [activity.workflow.name ?? "Workflow"]
  if (activity.loop) return [`Loop · ${String(activity.loop.done)}/${String(activity.loop.total)}`]
  return []
}
