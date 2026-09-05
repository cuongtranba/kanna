
import type { AutoContinueEvent } from "./events"

const MAX_LIVE_LOOP_RUN_OUTCOMES = 3

export function compactLoopWakeEvents(events: AutoContinueEvent[]): AutoContinueEvent[] {
  const dropped = new Set<number>()


  let lastArmIndex = -1
  let lastDisarmIndex = -1
  let loopCurrentlyArmed = false

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]
    if (event === undefined) continue
    if (event.kind === "loop_armed") {
      lastArmIndex = i
      loopCurrentlyArmed = true
    } else if (event.kind === "loop_disarmed") {
      lastDisarmIndex = i
      loopCurrentlyArmed = false
    }
  }

  if (lastArmIndex >= 0 && !loopCurrentlyArmed) {
    for (let i = 0; i < events.length; i += 1) {
      if (i === lastArmIndex || i === lastDisarmIndex) continue
      const event = events[i]
      if (event === undefined) continue
      if (
        event.kind === "loop_armed" ||
        event.kind === "loop_disarmed" ||
        event.kind === "loop_run_outcome"
      ) {
        dropped.add(i)
      }
    }
  } else if (lastArmIndex > 0) {
    for (let i = 0; i < lastArmIndex; i += 1) {
      const event = events[i]
      if (event === undefined) continue
      if (
        event.kind === "loop_armed" ||
        event.kind === "loop_disarmed" ||
        event.kind === "loop_run_outcome"
      ) {
        dropped.add(i)
      }
    }
  }

  if (loopCurrentlyArmed && lastArmIndex >= 0) {
    const outcomeIndices: number[] = []
    for (let i = lastArmIndex + 1; i < events.length; i += 1) {
      const event = events[i]
      if (event === undefined || dropped.has(i)) continue
      if (event.kind === "loop_run_outcome") outcomeIndices.push(i)
    }
    const excess = outcomeIndices.length - MAX_LIVE_LOOP_RUN_OUTCOMES
    for (let j = 0; j < excess; j += 1) {
      dropped.add(outcomeIndices[j]!)
    }
  }


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
