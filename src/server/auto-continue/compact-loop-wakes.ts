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
 * Each `loop_armed` event carries the full rendered loop prompt (several KB).
 * After a later `loop_armed` or `loop_disarmed`, earlier loop-state events
 * (`loop_armed`, `loop_disarmed`, `loop_run_outcome`) are dead:
 *   - `deriveLoopState` resets `consecutiveFailures` on every `loop_armed`, so
 *     outcomes from a prior arm carry no weight in the current arm's count
 *   - A `loop_disarmed` with no subsequent `loop_armed` means the loop is off,
 *     so its outcomes are dead — but the arm/disarm PAIR itself is retained as
 *     a tombstone, because `loop_armed` is the only carrier of the loop spec
 *     (`resume_loop` re-arms from it, and the un-armed delivery prompt names
 *     the loop's real tracking file from it)
 *
 * Returns the input by reference when nothing was dropped — the common case
 * between iterations, so the append path allocates nothing until there is
 * actually settled waste to reclaim. Never mutates the input.
 */

import type { AutoContinueEvent } from "./events"

export function compactLoopWakeEvents(events: AutoContinueEvent[]): AutoContinueEvent[] {
  const dropped = new Set<number>()

  // ─── Loop-state trimming ──────────────────────────────────────────────────
  //
  // Walk the log once to find the arm boundary. All loop_armed,
  // loop_disarmed, and loop_run_outcome events before the last loop_armed
  // are dead. If the loop is currently disarmed (no loop_armed follows the
  // last loop_disarmed), every loop-state event can be dropped.

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
    // The loop was armed but is now disarmed — every loop-state event is dead
    // EXCEPT the last `loop_armed` + `loop_disarmed` PAIR, retained as a
    // tombstone. Both halves or neither: keeping the arm alone would replay
    // through `deriveLoopState` as a still-ARMED loop, silently re-arming a
    // loop the user stopped (pinned by "deriveLoopState returns null after
    // disarmed-loop compaction").
    //
    // That event is the sole carrier of `subagentId`, the rendered `prompt`,
    // `verifyCommand`, `workdirAbs` and `trackingFileRel`. Dropping it made a
    // disarm irreversible AND unnameable: `resume_loop` had nothing to re-arm
    // from, and the un-armed delivery prompt could not say which tracking file
    // (or which worktree) the loop worked in, so it fell back to a hardcoded
    // "PROGRESS.md" that resolved against the wrong checkout. Retaining ONE
    // event per chat is bounded — the waste this module exists to reclaim is
    // the same multi-KB prompt re-embedded on every WAKE, not one tombstone.
    //
    // Guard on lastArmIndex >= 0: orphaned loop_run_outcome events with no
    // loop_armed in the log are already ignored by deriveLoopState (state===null
    // branch), so skipping them here avoids an allocation for nothing.
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
    // Multiple arms: events before the last arm are dead.
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

  // ─── Loop-wake accepted+settled pair trimming ─────────────────────────────

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
