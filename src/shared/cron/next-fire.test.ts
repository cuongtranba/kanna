import { describe, expect, test } from "bun:test"
import { nextFireAt } from "./next-fire"
import { parseSchedule } from "./parse-schedule"
import type { CronSchedule } from "./types"

function scheduleOf(text: string): CronSchedule {
  const parsed = parseSchedule(text)
  if (!parsed.ok) throw new Error(`expected "${text}" to parse: ${parsed.message}`)
  return parsed.schedule
}

/**
 * Expectations are built from local Date fields (never hard-coded epochs) so
 * the suite passes in any timezone — cron matching itself runs on local
 * wall-clock fields.
 */
function local(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute).getTime()
}

describe("cron next fire", () => {
  test("every-5-minutes snaps to the next multiple within the hour", () => {
    const at = nextFireAt(scheduleOf("*/5 * * * *"), local(2026, 8, 16, 10, 7), 0)
    expect(at).toBe(local(2026, 8, 16, 10, 10))
  })

  test("fires strictly after from, never at it", () => {
    const at = nextFireAt(scheduleOf("*/5 * * * *"), local(2026, 8, 16, 10, 10), 0)
    expect(at).toBe(local(2026, 8, 16, 10, 15))
  })

  test("daily at 09:00 rolls to tomorrow after the hour has passed", () => {
    const at = nextFireAt(scheduleOf("0 9 * * *"), local(2026, 8, 16, 12, 0), 0)
    expect(at).toBe(local(2026, 8, 17, 9, 0))
  })

  test("weekday schedule skips the weekend", () => {
    // 2026-08-14 is a Friday.
    const at = nextFireAt(scheduleOf("0 9 * * 1-5"), local(2026, 8, 14, 10, 0), 0)
    expect(at).toBe(local(2026, 8, 17, 9, 0))
  })

  test("month rollover lands on the 1st", () => {
    const at = nextFireAt(scheduleOf("0 0 1 * *"), local(2026, 8, 16, 0, 0), 0)
    expect(at).toBe(local(2026, 9, 1, 0, 0))
  })

  test("Jan 31 to Feb skips to the next existing 31st", () => {
    const at = nextFireAt(scheduleOf("0 0 31 * *"), local(2026, 1, 31, 1, 0), 0)
    expect(at).toBe(local(2026, 3, 31, 0, 0))
  })

  test("Feb 29 resolves to the next leap year", () => {
    const at = nextFireAt(scheduleOf("0 0 29 2 *"), local(2026, 3, 1, 0, 0), 0)
    expect(at).toBe(local(2028, 2, 29, 0, 0))
  })

  test("Feb 30 never fires and returns null", () => {
    expect(nextFireAt(scheduleOf("0 0 30 2 *"), local(2026, 8, 16), 0)).toBeNull()
  })

  test("vixie OR rule: both dom and dow restricted fires on either", () => {
    // 2026-08-16 is a Sunday; `0 0 20 * 1` = day 20 OR Monday.
    const schedule = scheduleOf("0 0 20 * 1")
    const first = nextFireAt(schedule, local(2026, 8, 16, 1, 0), 0)
    expect(first).toBe(local(2026, 8, 17, 0, 0)) // Monday the 17th
    const second = nextFireAt(schedule, first!, 0)
    expect(second).toBe(local(2026, 8, 20, 0, 0)) // the 20th (a Thursday)
  })

  test("stepped dom with plain-star dow still constrains the day (AND)", () => {
    // */2 in dom is unrestricted for the OR rule but its values still apply.
    const at = nextFireAt(scheduleOf("0 0 */2 * *"), local(2026, 8, 16, 1, 0), 0)
    expect(at).toBe(local(2026, 8, 17, 0, 0)) // days 1,3,…,17 — next odd day
  })

  test("restricted dom with unrestricted dow is a plain dom match", () => {
    const at = nextFireAt(scheduleOf("0 0 15 * *"), local(2026, 8, 16, 0, 0), 0)
    expect(at).toBe(local(2026, 9, 15, 0, 0))
  })
})

describe("interval next fire", () => {
  const schedule: CronSchedule = { type: "interval", ms: 300_000 }

  test("anchors at arm time, first fire one interval later", () => {
    const armedAt = local(2026, 8, 16, 10, 2)
    expect(nextFireAt(schedule, armedAt, armedAt)).toBe(armedAt + 300_000)
  })

  test("stays on the anchor grid after missed time", () => {
    const armedAt = local(2026, 8, 16, 10, 2)
    const from = armedAt + 12 * 60_000 + 1 // 12m01s later, mid-grid
    expect(nextFireAt(schedule, from, armedAt)).toBe(armedAt + 15 * 60_000)
  })

  test("a fire moment itself advances to the next slot", () => {
    const armedAt = local(2026, 8, 16, 10, 2)
    expect(nextFireAt(schedule, armedAt + 300_000, armedAt)).toBe(armedAt + 600_000)
  })

  test("from before the anchor fires one interval after the anchor", () => {
    const armedAt = local(2026, 8, 16, 10, 2)
    expect(nextFireAt(schedule, armedAt - 60_000, armedAt)).toBe(armedAt + 300_000)
  })
})
