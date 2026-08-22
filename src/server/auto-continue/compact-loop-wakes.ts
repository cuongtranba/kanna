/**
 * Retention for loop-wake auto-continue events.
 *
 * Each loop iteration emits an `auto_continue_accepted` (source:
 * "subagent_background") event whose `prompt` field carries the full loop
 * discipline (several KB). Followed by `auto_continue_fired` once the schedule
 * runs. Measured on one install: 285 KB for a long-running loop chat, 91% of
 * it the same prompt re-embedded on every wake by `deliverSubagentToMain`.
 *
 * After an `auto_continue_accepted`+`auto_continue_fired` pair settles, neither
 * event affects any live read:
 *   - `deriveLoopState` only reads `loop_armed`, `loop_disarmed`,
 *     `loop_run_outcome` — never `auto_continue_accepted`
 *   - `deriveChatSchedules` needs accepted events only while they are PENDING;
 *     once fired, the schedule state is terminal
 *   - `getChatSchedule` / `fireAutoContinue` reads the prompt at fire time, so
 *     dropping the event after the fired pair is durable-safe
 *
 * Cancelled accepted events (via `auto_continue_cancelled`) are equally dead —
 * the prompt will never be replayed.
 *
 * Returns the input by reference when nothing was dropped — the common case
 * between iterations, so the append path allocates nothing until there is
 * actually settled waste to reclaim. Never mutates the input.
 */

import type { AutoContinueEvent } from "./events"

export function compactLoopWakeEvents(events: AutoContinueEvent[]): AutoContinueEvent[] {
  const dropped = new Set<number>()

  // Index of each pending loop-wake accepted event, keyed by scheduleId.
  // Removed once the schedule is settled (fired or cancelled).
  const pendingByScheduleId = new Map<string, number>()

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]
    if (event === undefined) continue

    if (
      event.kind === "auto_continue_accepted" &&
      event.source === "subagent_background"
    ) {
      pendingByScheduleId.set(event.scheduleId, i)
      continue
    }

    if (
      event.kind === "auto_continue_fired" ||
      event.kind === "auto_continue_cancelled"
    ) {
      const acceptedIndex = pendingByScheduleId.get(event.scheduleId)
      if (acceptedIndex !== undefined) {
        dropped.add(acceptedIndex)
        dropped.add(i)
        pendingByScheduleId.delete(event.scheduleId)
      }
    }
  }

  if (dropped.size === 0) return events
  return events.filter((_, index) => !dropped.has(index))
}
