import type { AutoContinueSchedule } from "../../shared/types"
import type { AutoContinueEvent } from "./events"

export interface ChatSchedulesProjection {
  schedules: Record<string, AutoContinueSchedule>
  liveScheduleId: string | null
}

/** Armed-loop state for a chat, or null when no loop is currently armed. */
export interface LoopState {
  subagentId: string
  prompt: string
  /** Timestamp of the `loop_armed` event that armed the current loop. Used by
   *  the Loop Progress panel to exclude delegations from before the arm. */
  armedAt: number
  /**
   * Delegated iterations that have failed back-to-back since the last success.
   * Reset by `loop_armed` and by any successful run. Lets the host disarm a
   * loop that cannot make progress, instead of re-firing it indefinitely or
   * relying on the model to give up at the right moment.
   */
  consecutiveFailures: number
  /** The loop's oracle command, or null for a loop armed before this was recorded. */
  verifyCommand: string | null
  /** Absolute directory the oracle runs in, or null (see `verifyCommand`). */
  workdirAbs: string | null
  /**
   * Tracking file relative to `workdirAbs`, or null for a loop armed before
   * this was recorded. Read at delegate time to label a Progress row with the
   * chunk being worked when the orchestrator did not name it itself.
   */
  trackingFileRel: string | null
}

/**
 * Fold the auto-continue event log into the chat's current armed-loop state.
 * The latest `loop_armed` wins; a later `loop_disarmed` clears it. Pure replay
 * over the same durable event stream `deriveChatSchedules` uses, so it survives
 * restart for free. Used to (a) re-inject the loop prompt on every
 * background-completion wake, (b) tool-block loop-orchestrator turns, and
 * (c) decide when a failing loop has earned an automatic disarm.
 */
export function deriveLoopState(
  events: readonly AutoContinueEvent[],
  chatId: string,
): LoopState | null {
  // `failures` is tracked alongside rather than folded into `state` on every
  // event: it avoids rebuilding the state object per outcome, and it keeps the
  // one spread outside the loop where its operand is definitely an object.
  let state: Omit<LoopState, "consecutiveFailures"> | null = null
  let failures = 0
  for (const event of events) {
    if (event.chatId !== chatId) continue
    if (event.kind === "loop_armed") {
      state = {
        subagentId: event.subagentId,
        prompt: event.prompt,
        armedAt: event.timestamp,
        verifyCommand: event.verifyCommand ?? null,
        workdirAbs: event.workdirAbs ?? null,
        trackingFileRel: event.trackingFileRel ?? null,
      }
      failures = 0
    } else if (event.kind === "loop_disarmed") {
      state = null
      failures = 0
    } else if (event.kind === "loop_run_outcome" && state !== null) {
      // Outcomes arriving while no loop is armed are ignored, not counted:
      // they belong to a run the user already stopped.
      failures = event.ok ? 0 : failures + 1
    }
  }
  return state === null ? null : { ...state, consecutiveFailures: failures }
}

const EMPTY: ChatSchedulesProjection = { schedules: {}, liveScheduleId: null }

export function deriveChatSchedules(
  events: readonly AutoContinueEvent[],
  chatId?: string
): ChatSchedulesProjection {
  const schedules: Record<string, AutoContinueSchedule> = {}
  let liveScheduleId: string | null = null
  for (const event of events) {
    if (chatId && event.chatId !== chatId) continue
    applyOne(schedules, event)
    const schedule = schedules[event.scheduleId]
    if (schedule && (schedule.state === "proposed" || schedule.state === "scheduled")) {
      liveScheduleId = schedule.scheduleId
    } else if (liveScheduleId === event.scheduleId) {
      liveScheduleId = null
    }
  }

  if (Object.keys(schedules).length === 0 && liveScheduleId === null) return EMPTY
  return { schedules, liveScheduleId }
}

function applyOne(schedules: Record<string, AutoContinueSchedule>, event: AutoContinueEvent): void {
  switch (event.kind) {
    case "auto_continue_proposed":
      schedules[event.scheduleId] = {
        scheduleId: event.scheduleId,
        state: "proposed",
        scheduledAt: null,
        tz: event.tz,
        resetAt: event.resetAt,
        detectedAt: event.detectedAt,
      }
      return
    case "auto_continue_accepted":
      schedules[event.scheduleId] = {
        scheduleId: event.scheduleId,
        state: "scheduled",
        scheduledAt: event.scheduledAt,
        tz: event.tz,
        resetAt: event.resetAt,
        detectedAt: event.detectedAt,
        ...(event.prompt !== undefined ? { prompt: event.prompt } : {}),
      }
      return
    case "auto_continue_rescheduled": {
      const existing = schedules[event.scheduleId]
      if (!existing) return
      schedules[event.scheduleId] = { ...existing, scheduledAt: event.scheduledAt }
      return
    }
    case "auto_continue_cancelled": {
      const existing = schedules[event.scheduleId]
      if (!existing) return
      schedules[event.scheduleId] = { ...existing, state: "cancelled" }
      return
    }
    case "auto_continue_fired": {
      const existing = schedules[event.scheduleId]
      if (!existing) {
        schedules[event.scheduleId] = {
          scheduleId: event.scheduleId,
          state: "fired",
          scheduledAt: event.timestamp,
          tz: "system",
          resetAt: event.timestamp,
          detectedAt: event.timestamp,
        }
        return
      }
      schedules[event.scheduleId] = { ...existing, state: "fired", scheduledAt: event.timestamp }
      
    }
  }
}
