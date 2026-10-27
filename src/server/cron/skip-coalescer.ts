
import type { CronSkipReason } from "../../shared/cron/types"
import { cronJobKey, cronJobKeyPrefix } from "./job-key"

export const SKIP_FLUSH_WINDOW_MS = 60_000

export type CoalescedSkipReason = Exclude<CronSkipReason, "server_offline">

export interface CronSkipRecord {
  reason: CoalescedSkipReason
  count: number
}

export interface CronSkipCoalescerPort {
  record(chatId: string, jobId: string, reason: CoalescedSkipReason, now: number): CronSkipRecord | null
  flushPending(chatId: string, jobId: string, now: number): CronSkipRecord | null
  forget(chatId: string, jobId: string): void
}

interface SkipState {
  reason: CoalescedSkipReason
  pending: number
  lastWriteAt: number
}

export class CronSkipCoalescer implements CronSkipCoalescerPort {
  private readonly states = new Map<string, SkipState>()

  constructor(private readonly windowMs: number = SKIP_FLUSH_WINDOW_MS) {}

  record(chatId: string, jobId: string, reason: CoalescedSkipReason, now: number): CronSkipRecord | null {
    const key = cronJobKey(chatId, jobId)
    const state = this.states.get(key)

    if (!state) {
      this.states.set(key, { reason, pending: 0, lastWriteAt: now })
      return { reason, count: 1 }
    }

    if (state.reason !== reason) {
      const owed = state.pending
      this.states.set(key, { reason, pending: owed > 0 ? 1 : 0, lastWriteAt: now })
      return owed > 0 ? { reason: state.reason, count: owed } : { reason, count: 1 }
    }

    state.pending += 1
    if (now - state.lastWriteAt < this.windowMs) return null
    return this.take(state, now)
  }

  flushPending(chatId: string, jobId: string, now: number): CronSkipRecord | null {
    const state = this.states.get(cronJobKey(chatId, jobId))
    if (!state || state.pending === 0) return null
    if (now - state.lastWriteAt < this.windowMs) return null
    return this.take(state, now)
  }

  forget(chatId: string, jobId: string): void {
    this.states.delete(cronJobKey(chatId, jobId))
  }

  clearChat(chatId: string): void {
    const prefix = cronJobKeyPrefix(chatId)
    for (const key of this.states.keys()) {
      if (key.startsWith(prefix)) this.states.delete(key)
    }
  }

  private take(state: SkipState, now: number): CronSkipRecord {
    const record: CronSkipRecord = { reason: state.reason, count: state.pending }
    state.pending = 0
    state.lastWriteAt = now
    return record
  }
}

