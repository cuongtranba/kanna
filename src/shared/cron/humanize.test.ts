import { describe, expect, test } from "bun:test"
import { humanizeSchedule } from "./humanize"
import { parseSchedule } from "./parse-schedule"

function humanized(text: string): string {
  const parsed = parseSchedule(text)
  if (!parsed.ok) throw new Error(`expected "${text}" to parse: ${parsed.message}`)
  return humanizeSchedule(parsed.schedule, text)
}

describe("humanizeSchedule", () => {
  test("intervals", () => {
    expect(humanized("every 1m")).toBe("every minute")
    expect(humanized("every 5m")).toBe("every 5 minutes")
    expect(humanized("every 1h")).toBe("every hour")
    expect(humanized("every 2h")).toBe("every 2 hours")
    expect(humanized("every 90m")).toBe("every 90 minutes")
  })

  test("common cron shapes", () => {
    expect(humanized("* * * * *")).toBe("every minute")
    expect(humanized("30 * * * *")).toBe("hourly at :30")
    expect(humanized("0 9 * * *")).toBe("daily at 09:00")
    expect(humanized("0 9 * * 1")).toBe("every Monday at 09:00")
    expect(humanized("0 0 1 * *")).toBe("on day 1 of each month at 00:00")
  })

  test("shortcut text falls into the same shapes", () => {
    expect(humanized("@daily")).toBe("daily at 00:00")
    expect(humanized("@hourly")).toBe("hourly at :00")
  })

  test("irregular schedules fall back to the raw text", () => {
    expect(humanized("*/7 3,9 * 2 *")).toBe("*/7 3,9 * 2 *")
  })
})
