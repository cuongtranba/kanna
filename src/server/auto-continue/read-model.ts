import type { AutoContinueSchedule } from "../../shared/types"
import type { AutoContinueEvent } from "./events"

export interface ChatSchedulesProjection {
  schedules: Record<string, AutoContinueSchedule>
  liveScheduleId: string | null
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
      return
    }
  }
}
