import { describe, expect, test } from "bun:test"
import { formatCronDefect, formatCronRepairRequest } from "./repair-report"
import { parseCronCommand } from "./parse-command"
import type { CronParseError } from "./types"

function errorOf(line: string): CronParseError {
  const parsed = parseCronCommand(line)
  if (!parsed) throw new Error(`expected "${line}" to be a /cron command`)
  if (parsed.ok) throw new Error(`expected "${line}" to fail`)
  return parsed.error
}

describe("formatCronDefect", () => {
  test("names the failing part and why", () => {
    const text = formatCronDefect(errorOf("/cron check ci inline 0 9 * * 8"))
    expect(text).toContain("schedule_field")
    expect(text).toContain("day-of-week")
  })

  test("carries the deterministic fix when there is one", () => {
    expect(formatCronDefect(errorOf("/cron check ci spwan @daily"))).toContain(
      "/cron check ci spawn @daily",
    )
  })
})

describe("formatCronRepairRequest", () => {
  const request = formatCronRepairRequest(errorOf("/cron check CI inline 9am every day"))

  test("quotes the line the user actually typed", () => {
    expect(request).toContain("/cron check CI inline 9am every day")
  })

  test("carries the parser's own diagnosis", () => {
    expect(request).toContain("expected 5")
  })

  // The whole point is that the model acts. A line to retype is what the user
  // already failed at three times.
  test("names both tools and the two ways out", () => {
    expect(request).toContain("mcp__kanna__validate_cron")
    expect(request).toContain("mcp__kanna__arm_cron")
    expect(request).toContain("AskUserQuestion")
  })

  test("teaches the grammar it is asking the model to produce", () => {
    expect(request).toContain("/cron <instruction> <inline|spawn> <schedule>")
    expect(request).toContain("@daily")
    expect(request).toContain("every 5m")
  })

  // A repaired cron must still be the user's cron.
  test("forbids inventing an instruction", () => {
    expect(request.toLowerCase()).toContain("never invent")
  })
})
