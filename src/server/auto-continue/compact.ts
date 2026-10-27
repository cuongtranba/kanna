import { compactCronRunEvents } from "../cron/compact"
import { compactLoopWakeEvents } from "./compact-loop-wakes"
import type { AutoContinueEvent } from "./events"

export function compactAutoContinueEvents(events: AutoContinueEvent[]): AutoContinueEvent[] {
  return compactLoopWakeEvents(compactCronRunEvents(events))
}
