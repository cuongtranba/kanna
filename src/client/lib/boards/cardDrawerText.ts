
import type { StartWorkResult } from "../../../shared/boards/start-work"
import type { CardActor } from "../../../shared/boards/types"
import type { ChatActivity } from "../../../shared/types"

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

export function describeStartWork(result: StartWorkResult): string | null {
  if (result.reused) return null
  if (result.movedToColumnId === null) return "Started · no column marked active"
  return null
}

export function workDetailRows(activity: ChatActivity): readonly string[] {
  if (activity.agents > 0) return [`${activity.agents} agent${activity.agents === 1 ? "" : "s"}`]
  if (activity.workflow) return [activity.workflow.name ?? "Workflow"]
  if (activity.loop) return [`Loop · ${String(activity.loop.done)}/${String(activity.loop.total)}`]
  return []
}
