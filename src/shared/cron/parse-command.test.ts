import { describe, expect, test } from "bun:test"
import { parseCronCommand } from "./parse-command"
import type { CronCommand, CronParseError } from "./types"

function commandOf(line: string): CronCommand {
  const parsed = parseCronCommand(line)
  if (!parsed) throw new Error(`expected "${line}" to be a /cron command`)
  if (!parsed.ok) throw new Error(`expected "${line}" to parse: ${parsed.error.message}`)
  return parsed.command
}

function errorOf(line: string): CronParseError {
  const parsed = parseCronCommand(line)
  if (!parsed) throw new Error(`expected "${line}" to be a /cron command`)
  if (parsed.ok) throw new Error(`expected "${line}" to fail`)
  return parsed.error
}

describe("interception boundary", () => {
  test("non-cron messages pass through as null", () => {
    expect(parseCronCommand("hello")).toBeNull()
    expect(parseCronCommand("/clear")).toBeNull()
    expect(parseCronCommand("/cronx foo")).toBeNull()
  })

  test("any /cron line is intercepted, even invalid ones", () => {
    expect(parseCronCommand("/cron total nonsense here")).not.toBeNull()
  })

  test("a multiline /cron message is an error, not a prompt", () => {
    const parsed = parseCronCommand("/cron check ci inline @daily\nsecond line")
    expect(parsed?.ok).toBe(false)
  })

  // Distinct from "subcommand" so the repair escalation can treat it as
  // arm-shaped (repairable) without also opening up real subcommand typos
  // like `/cron list extra`, which already carry a mechanical suggestion.
  test("a multiline /cron message carries its own part, not subcommand", () => {
    const error = errorOf("/cron check ci inline @daily\nsecond line")
    expect(error.part).toBe("multiline")
    expect(error.suggestion).toBeUndefined()
  })
})

describe("subcommands", () => {
  test("bare /cron and /cron help are help", () => {
    expect(commandOf("/cron")).toEqual({ sub: "help" })
    expect(commandOf("/cron help")).toEqual({ sub: "help" })
  })

  test("list, remove, pause, resume", () => {
    expect(commandOf("/cron list")).toEqual({ sub: "list" })
    expect(commandOf("/cron remove cron-a1")).toEqual({ sub: "remove", jobId: "cron-a1" })
    expect(commandOf("/cron pause cron-a1")).toEqual({ sub: "pause", jobId: "cron-a1" })
    expect(commandOf("/cron resume cron-a1")).toEqual({ sub: "resume", jobId: "cron-a1" })
  })

  test("remove without an id points at /cron list", () => {
    const error = errorOf("/cron remove")
    expect(error.part).toBe("subcommand")
    expect(error.suggestion).toBe("/cron list")
  })

  test("an instruction starting with a subcommand word still arms", () => {
    const command = commandOf("/cron remove old sessions inline @daily")
    expect(command).toMatchObject({ sub: "arm", instruction: "remove old sessions", mode: "inline" })
  })
})

describe("arm grammar", () => {
  test("anchors on the last mode token — no quoting needed", () => {
    const command = commandOf("/cron check CI status and report inline every 5m")
    expect(command).toMatchObject({
      sub: "arm",
      instruction: "check CI status and report",
      mode: "inline",
      scheduleText: "every 5m",
    })
  })

  test("an instruction containing a mode word uses the LAST occurrence", () => {
    const command = commandOf("/cron fix the inline styles spawn @daily")
    expect(command).toMatchObject({ sub: "arm", instruction: "fix the inline styles", mode: "spawn" })
  })

  test("quoted instruction is the escape hatch for trailing mode words", () => {
    const command = commandOf('/cron "audit everything inline" spawn @weekly')
    expect(command).toMatchObject({ sub: "arm", instruction: "audit everything inline", mode: "spawn" })
  })

  test("5-field schedules keep their exact text", () => {
    const command = commandOf("/cron daily report spawn 0 9 * * 1-5")
    expect(command).toMatchObject({ sub: "arm", mode: "spawn", scheduleText: "0 9 * * 1-5" })
  })

  test("a quoted schedule is unwrapped", () => {
    const command = commandOf('/cron daily report spawn "0 9 * * 1"')
    expect(command).toMatchObject({ sub: "arm", scheduleText: "0 9 * * 1" })
  })
})

describe("validation errors and suggestions", () => {
  test("missing instruction", () => {
    expect(errorOf("/cron inline @daily").part).toBe("instruction")
  })

  test("missing schedule", () => {
    expect(errorOf("/cron check ci inline").part).toBe("schedule")
  })

  test("unclosed quote", () => {
    expect(errorOf('/cron "check ci inline @daily').part).toBe("instruction")
  })

  test("a typo'd mode is caught by edit distance with a full corrected line", () => {
    const error = errorOf("/cron check ci spwan @daily")
    expect(error.part).toBe("mode")
    expect(error.message).toContain("spwan")
    expect(error.suggestion).toBe("/cron check ci spawn @daily")
  })

  test("a missing mode before a valid schedule suggests inline", () => {
    const error = errorOf("/cron check ci every 5m")
    expect(error.part).toBe("mode")
    expect(error.suggestion).toBe("/cron check ci inline every 5m")
  })

  test("a bad schedule field surfaces the field-level message", () => {
    const error = errorOf("/cron check ci inline 0 9 * * 8")
    expect(error.part).toBe("schedule_field")
    expect(error.message).toContain("day-of-week")
  })

  test("a correctable schedule yields a full corrected command", () => {
    const error = errorOf("/cron check ci inline every 5min")
    expect(error.part).toBe("schedule")
    expect(error.suggestion).toBe("/cron check ci inline every 5m")
  })

  test("4-field cron suggests the 5-field form", () => {
    const error = errorOf("/cron nightly build spawn 0 3 * *")
    expect(error.suggestion).toBe("/cron nightly build spawn 0 3 * * *")
  })

  test("a short cron whose fields are valid is padded with wildcards", () => {
    expect(errorOf("/cron nightly build spawn 0 3 *").suggestion).toBe(
      "/cron nightly build spawn 0 3 * * *",
    )
    expect(errorOf("/cron nightly build spawn 0 3").suggestion).toBe(
      "/cron nightly build spawn 0 3 * * *",
    )
  })

  // Padding only helps when the fields themselves are cron. "9am every day" is
  // English, and guessing at it is exactly the job the model picks up.
  test("a short schedule that is not cron at all offers no suggestion", () => {
    const error = errorOf("/cron check ci inline 9am every day")
    expect(error.part).toBe("schedule")
    expect(error.suggestion).toBeUndefined()
  })
})

// The offending line is the one thing the old error entry did not keep, which
// left both the user and the model with nothing to work from.
describe("the offending line is recorded", () => {
  test("every parse error carries the line it came from", () => {
    for (const line of ["/cron remove", "/cron check ci inline 9am every day", "/cron nonsense"]) {
      expect(errorOf(line).input).toBe(line)
    }
  })

  test("the recorded line is trimmed, matching what was parsed", () => {
    expect(errorOf("  /cron nonsense  ").input).toBe("/cron nonsense")
  })

  test("a multiline /cron message records the whole message", () => {
    expect(errorOf("/cron check ci inline @daily\nsecond line").input).toBe(
      "/cron check ci inline @daily\nsecond line",
    )
  })
})

describe("suggestion drift guard", () => {
  const invalidLines = [
    "/cron remove",
    "/cron remove a b",
    "/cron list extra",
    "/cron check ci spwan @daily",
    "/cron check ci every 5m",
    "/cron check ci inline every 5min",
    "/cron check ci inline every 30seconds",
    "/cron check ci inline every 1d",
    "/cron check ci inline @hour",
    "/cron check ci inline @daily 5m",
    "/cron nightly build spawn 0 3 * *",
    "/cron nightly build spawn 0 0 0 */5 * * *",
    "/cron check ci inline 5m",
    "/cron check ci inline every 0m",
    "/cron check ci inline every 0s",
  ]

  test("every emitted suggestion re-parses to a successful command", () => {
    for (const line of invalidLines) {
      const parsed = parseCronCommand(line)
      if (!parsed || parsed.ok) throw new Error(`fixture "${line}" should fail to parse`)
      const suggestion = parsed.error.suggestion
      if (suggestion === undefined) continue
      const reparsed = parseCronCommand(suggestion)
      expect(reparsed?.ok).toBe(true)
    }
  })

  test("the fixtures above actually produce suggestions where promised", () => {
    const withSuggestions = invalidLines.filter((line) => {
      const parsed = parseCronCommand(line)
      return parsed && !parsed.ok && parsed.error.suggestion !== undefined
    })
    expect(withSuggestions.length).toBeGreaterThanOrEqual(10)
  })
})
