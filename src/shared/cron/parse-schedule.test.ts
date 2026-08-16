import { describe, expect, test } from "bun:test"
import { parseSchedule } from "./parse-schedule"
import type { CronSchedule } from "./types"

function scheduleOf(text: string): CronSchedule {
  const parsed = parseSchedule(text)
  if (!parsed.ok) throw new Error(`expected "${text}" to parse: ${parsed.message}`)
  return parsed.schedule
}

function errorOf(text: string) {
  const parsed = parseSchedule(text)
  if (parsed.ok) throw new Error(`expected "${text}" to fail`)
  return parsed
}

describe("5-field cron", () => {
  test("parses star fields as any and keeps the raw expression", () => {
    const schedule = scheduleOf("* * * * *")
    expect(schedule).toEqual({
      type: "cron",
      expression: "* * * * *",
      minute: { kind: "any" },
      hour: { kind: "any" },
      dom: { kind: "any" },
      month: { kind: "any" },
      dow: { kind: "any" },
    })
  })

  test("expands steps, ranges, and lists", () => {
    const schedule = scheduleOf("*/15 9-11 1,15 * 1-5")
    if (schedule.type !== "cron") throw new Error("expected cron")
    expect(schedule.minute).toEqual({ kind: "values", values: [0, 15, 30, 45] })
    expect(schedule.hour).toEqual({ kind: "values", values: [9, 10, 11] })
    expect(schedule.dom).toEqual({ kind: "values", values: [1, 15] })
    expect(schedule.dow).toEqual({ kind: "values", values: [1, 2, 3, 4, 5] })
    // The occurrence engine (node-cron) evaluates the expression verbatim.
    expect(schedule.expression).toBe("*/15 9-11 1,15 * 1-5")
  })

  test("accepts month and weekday names, normalizes dow 7 to 0", () => {
    const named = scheduleOf("0 9 * jan mon")
    if (named.type !== "cron") throw new Error("expected cron")
    expect(named.month).toEqual({ kind: "values", values: [1] })
    expect(named.dow).toEqual({ kind: "values", values: [1] })

    const sunday = scheduleOf("0 0 * * 7")
    if (sunday.type !== "cron") throw new Error("expected cron")
    expect(sunday.dow).toEqual({ kind: "values", values: [0] })
  })

  test("names the offending field and its range", () => {
    expect(errorOf("61 * * * *").message).toContain("minute")
    expect(errorOf("61 * * * *").message).toContain("0-59")
    expect(errorOf("* 24 * * *").message).toContain("hour")
    expect(errorOf("* * 0 * *").message).toContain("day-of-month")
    expect(errorOf("* * * 13 *").message).toContain("month")
    expect(errorOf("* * * * 8").message).toContain("day-of-week")
    expect(errorOf("* * * * 8").message).toContain("0-7")
    expect(errorOf("* * * * 8").part).toBe("schedule_field")
  })

  test("rejects bad shapes with a reason", () => {
    expect(errorOf("5-1 * * * *").message).toContain("range end below its start")
    expect(errorOf("*/0 * * * *").message).toContain("step")
    expect(errorOf("5/2 * * * *").message).toContain("single value")
    expect(errorOf("1,,2 * * * *").message).toContain("empty list entry")
    expect(errorOf("0 9 * * frx").message).toContain("not a valid day-of-week name")
  })

  test("4 fields suggests appending a star", () => {
    const error = errorOf("*/5 * * *")
    expect(error.message).toContain("4 fields")
    expect(error.correctedSchedule).toBe("*/5 * * * *")
  })

  test("a bare interval token suggests the every form", () => {
    expect(errorOf("5m").correctedSchedule).toBe("every 5m")
    expect(errorOf("30s").correctedSchedule).toBe("every 30s")
  })
})

describe("6-field cron (leading second)", () => {
  test("parses the second field and keeps the expression verbatim", () => {
    const schedule = scheduleOf("*/30 * * * * *")
    expect(schedule).toEqual({
      type: "cron",
      expression: "*/30 * * * * *",
      second: { kind: "values", values: [0, 30] },
      minute: { kind: "any" },
      hour: { kind: "any" },
      dom: { kind: "any" },
      month: { kind: "any" },
      dow: { kind: "any" },
    })
  })

  test("the remaining five fields keep their 5-field meaning", () => {
    const schedule = scheduleOf("15 30 9 * * 1")
    if (schedule.type !== "cron") throw new Error("expected cron")
    expect(schedule.second).toEqual({ kind: "values", values: [15] })
    expect(schedule.minute).toEqual({ kind: "values", values: [30] })
    expect(schedule.hour).toEqual({ kind: "values", values: [9] })
    expect(schedule.dow).toEqual({ kind: "values", values: [1] })
  })

  test("a 5-field schedule carries no second field at all", () => {
    const schedule = scheduleOf("0 9 * * 1")
    if (schedule.type !== "cron") throw new Error("expected cron")
    expect(schedule.second).toBeUndefined()
  })

  test("the second field is range-checked like every other", () => {
    const error = errorOf("60 * * * * *")
    expect(error.message).toContain("second")
    expect(error.message).toContain("0-59")
    expect(error.part).toBe("schedule_field")
  })

  test("7 fields (Quartz) suggests dropping the trailing year", () => {
    const error = errorOf("0 0 12 * * 1 2026")
    expect(error.message).toContain("7 fields")
    expect(error.correctedSchedule).toBe("0 0 12 * * 1")
  })
})

describe("@shortcuts", () => {
  test("maps to their cron equivalents", () => {
    expect(scheduleOf("@hourly")).toEqual(scheduleOf("0 * * * *"))
    expect(scheduleOf("@daily")).toEqual(scheduleOf("0 0 * * *"))
    expect(scheduleOf("@weekly")).toEqual(scheduleOf("0 0 * * 0"))
    expect(scheduleOf("@monthly")).toEqual(scheduleOf("0 0 1 * *"))
  })

  test("is case-insensitive", () => {
    expect(scheduleOf("@Daily")).toEqual(scheduleOf("@daily"))
  })

  test("unknown shortcut suggests the nearest one", () => {
    const error = errorOf("@hour")
    expect(error.message).toContain("@hour")
    expect(error.correctedSchedule).toBe("@hourly")
  })

  test("extra tokens after a shortcut suggest the bare shortcut", () => {
    expect(errorOf("@daily 5m").correctedSchedule).toBe("@daily")
  })
})

describe("every-interval sugar", () => {
  test("parses seconds, minutes, and hours", () => {
    expect(scheduleOf("every 1s")).toEqual({ type: "interval", ms: 1_000 })
    expect(scheduleOf("every 30s")).toEqual({ type: "interval", ms: 30_000 })
    expect(scheduleOf("every 90s")).toEqual({ type: "interval", ms: 90_000 })
    expect(scheduleOf("every 5m")).toEqual({ type: "interval", ms: 300_000 })
    expect(scheduleOf("every 2h")).toEqual({ type: "interval", ms: 7_200_000 })
  })

  test("verbose units suggest the short form", () => {
    expect(errorOf("every 5min").correctedSchedule).toBe("every 5m")
    expect(errorOf("every 5minutes").correctedSchedule).toBe("every 5m")
    expect(errorOf("every 2hours").correctedSchedule).toBe("every 2h")
    expect(errorOf("every 30seconds").correctedSchedule).toBe("every 30s")
    expect(errorOf("every 30sec").correctedSchedule).toBe("every 30s")
  })

  test("days route to @daily", () => {
    expect(errorOf("every 1d").correctedSchedule).toBe("@daily")
  })

  test("zero interval is refused in its own unit", () => {
    expect(errorOf("every 0m").correctedSchedule).toBe("every 1m")
    expect(errorOf("every 0s").correctedSchedule).toBe("every 1s")
  })

  test("a stray space is corrected", () => {
    expect(errorOf("every 5 m").correctedSchedule).toBe("every 5m")
  })

  test("missing interval is a plain error", () => {
    expect(errorOf("every").correctedSchedule).toBeUndefined()
  })
})
