/**
 * Consecutive skips collapse into one counted record.
 *
 * Skip-and-record is the overlap policy, and at minute cadence one record per
 * skipped tick is exactly right — the miss is rare and worth a card. Sub-minute
 * schedules invert that: a job firing every 5 s against a 20 s task skips three
 * ticks per cycle, and every one of them used to write a durable event AND a
 * transcript card into a JSONL log that is never compacted and is held per-chat
 * in memory. The information in those three cards is one sentence.
 *
 * The shape is a LEADING-EDGE throttle, per job:
 *
 * - the first skip after a quiet stretch is written immediately, carrying a
 *   count of one. This is what keeps a slow schedule honest — a `@daily` job
 *   skipped at 09:00 must say so at 09:00, not whenever it next ticks. Holding
 *   it back for a window would delay that notice by a DAY, because the window
 *   can only be noticed by a later tick;
 * - every skip inside the window is counted, not written;
 * - the accumulated count is written by the first tick (or run) past the
 *   window, so a fast job reports about once a minute no matter how often it
 *   skips, and a chat that stays wedged never goes silent.
 *
 * Counting at the tick rather than deriving the count at read time is
 * deliberate: deriving it means walking `CronTime.getNextDateFrom` across the
 * streak, MEASURED at ~42 µs per call, inside `deriveCronJobs` — which runs on
 * every chat broadcast. Incrementing an integer is O(1).
 *
 * The state is per-armed-job and process-local, the same durability the
 * `CronScheduler`'s own timers have; a restart re-reports through the
 * `server_offline` path, so nothing is silently lost. No IO.
 */

import type { CronSkipReason } from "../../shared/cron/types"

/** How long a job's skips are folded together after one has been written. */
export const SKIP_FLUSH_WINDOW_MS = 60_000

/**
 * The reasons a TICK is skipped. `server_offline` is not one of them — it is
 * synthesized once at boot by `reconcileCronRunsAtBoot`, already carrying its
 * own count, and never passes through here.
 */
export type CoalescedSkipReason = Exclude<CronSkipReason, "server_offline">

/** One skip record to write: its reason and how many ticks it stands for. */
export interface CronSkipRecord {
  reason: CoalescedSkipReason
  count: number
}

/** The seam `fire.ts` and `commands.ts` depend on (injected, never imported). */
export interface CronSkipCoalescerPort {
  /**
   * Count one skipped tick. Returns a record to WRITE, or null when the tick
   * was folded into the open window and nothing should be written yet.
   */
  record(chatId: string, jobId: string, reason: CoalescedSkipReason, now: number): CronSkipRecord | null
  /**
   * The job is about to actually run. Returns the folded count when the window
   * has passed, so the tail of a streak lands next to the run it was waiting
   * on; inside the window it keeps folding rather than carding every cycle.
   */
  flushPending(chatId: string, jobId: string, now: number): CronSkipRecord | null
  /** Drop a job's state without reporting it — it is gone, paused, or re-armed. */
  forget(chatId: string, jobId: string): void
}

interface SkipState {
  reason: CoalescedSkipReason
  /** Ticks counted since the last write. */
  pending: number
  /** When this job last had a skip record written. */
  lastWriteAt: number
}

export class CronSkipCoalescer implements CronSkipCoalescerPort {
  private readonly states = new Map<string, SkipState>()

  constructor(private readonly windowMs: number = SKIP_FLUSH_WINDOW_MS) {}

  record(chatId: string, jobId: string, reason: CoalescedSkipReason, now: number): CronSkipRecord | null {
    const key = keyOf(chatId, jobId)
    const state = this.states.get(key)

    if (!state) {
      this.states.set(key, { reason, pending: 0, lastWriteAt: now })
      return { reason, count: 1 }
    }

    // A different reason is a different story. Whatever the old one still owes
    // is reported under the OLD reason; the new one starts its own window.
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
    const state = this.states.get(keyOf(chatId, jobId))
    if (!state || state.pending === 0) return null
    if (now - state.lastWriteAt < this.windowMs) return null
    return this.take(state, now)
  }

  forget(chatId: string, jobId: string): void {
    this.states.delete(keyOf(chatId, jobId))
  }

  /** Every job on a chat (chat deleted). */
  clearChat(chatId: string): void {
    const prefix = `${chatId}\u0000`
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

/** Same NUL-joined shape the scheduler keys its jobs by. */
function keyOf(chatId: string, jobId: string): string {
  return `${chatId}\u0000${jobId}`
}
