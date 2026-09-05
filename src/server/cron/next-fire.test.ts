import { describe, expect, test } from "bun:test"
import { nextFireAt } from "./next-fire"
import { parseSchedule } from "../../shared/cron/parse-schedule"
import type { CronSchedule } from "../../shared/cron/types"

function scheduleOf(text: string): CronSchedule {
  const parsed = parseSchedule(text)
  if (!parsed.ok) throw new Error(`expected "${text}" to parse: ${parsed.message}`)
  return parsed.schedule
}

function local(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  return new Date(year, month - 1, day, hour, minute, second).getTime()
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
    const schedule = scheduleOf("0 0 20 * 1")
    const first = nextFireAt(schedule, local(2026, 8, 16, 1, 0), 0)
    expect(first).toBe(local(2026, 8, 17, 0, 0))
    const second = nextFireAt(schedule, first!, 0)
    expect(second).toBe(local(2026, 8, 20, 0, 0))
  })

  test("stepped dom with plain-star dow still constrains the day (AND)", () => {
    const at = nextFireAt(scheduleOf("0 0 */2 * *"), local(2026, 8, 16, 1, 0), 0)
    expect(at).toBe(local(2026, 8, 17, 0, 0))
  })

  test("restricted dom with unrestricted dow is a plain dom match", () => {
    const at = nextFireAt(scheduleOf("0 0 15 * *"), local(2026, 8, 16, 0, 0), 0)
    expect(at).toBe(local(2026, 9, 15, 0, 0))
  })
})

describe("6-field cron next fire (seconds)", () => {
  test("every-30-seconds lands on the next half minute", () => {
    const at = nextFireAt(scheduleOf("*/30 * * * * *"), local(2026, 8, 16, 10, 0, 5), 0)
    expect(at).toBe(local(2026, 8, 16, 10, 0, 30))
  })

  test("fires strictly after from, never at it", () => {
    const at = nextFireAt(scheduleOf("*/30 * * * * *"), local(2026, 8, 16, 10, 0, 30), 0)
    expect(at).toBe(local(2026, 8, 16, 10, 1, 0))
  })

  test("every second advances one second", () => {
    const at = nextFireAt(scheduleOf("* * * * * *"), local(2026, 8, 16, 10, 0, 7), 0)
    expect(at).toBe(local(2026, 8, 16, 10, 0, 8))
  })

  test("a second pins an instant inside an otherwise 5-field schedule", () => {
    const at = nextFireAt(scheduleOf("15 30 9 * * *"), local(2026, 8, 16, 12, 0, 0), 0)
    expect(at).toBe(local(2026, 8, 17, 9, 30, 15))
  })

  test("a 5-field schedule still fires on the minute boundary", () => {
    const at = nextFireAt(scheduleOf("*/5 * * * *"), local(2026, 8, 16, 10, 7, 30), 0)
    expect(at).toBe(local(2026, 8, 16, 10, 10, 0))
  })
})

describe("sub-minute interval next fire", () => {
  test("stays on the arm-time grid at second resolution", () => {
    const schedule: CronSchedule = { type: "interval", ms: 5_000 }
    const armedAt = local(2026, 8, 16, 10, 2, 3)
    expect(nextFireAt(schedule, armedAt, armedAt)).toBe(armedAt + 5_000)
    expect(nextFireAt(schedule, armedAt + 12_000, armedAt)).toBe(armedAt + 15_000)
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
    const from = armedAt + 12 * 60_000 + 1
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
