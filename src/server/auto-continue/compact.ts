import { compactCronRunEvents } from "../cron/compact"
import { compactLoopWakeEvents } from "./compact-loop-wakes"
import type { ChatAutomationEvent } from "./events"

export function compactAutoContinueEvents(events: ChatAutomationEvent[]): ChatAutomationEvent[] {
  return compactLoopWakeEvents(compactCronRunEvents(events))
}
