import { expect, test } from "vite-plus/test"
import { formatSnoozeUntil, parseSnoozeInput, snoozePresets } from "./inboxSnooze"

const SATURDAY_10AM = new Date(2026, 10, 7, 10, 0).getTime()

test("presets are three hours later, nine tomorrow and nine next Monday in local time", () => {
  const [later, tomorrow, nextWeek] = snoozePresets(SATURDAY_10AM)
  expect(later?.until).toBe(new Date(2026, 10, 7, 13, 0).getTime())
  expect(tomorrow?.until).toBe(new Date(2026, 10, 8, 9, 0).getTime())
  expect(nextWeek?.until).toBe(new Date(2026, 10, 9, 9, 0).getTime())
  const monday = new Date(2026, 10, 9, 15, 0).getTime()
  expect(snoozePresets(monday)[2]?.until).toBe(new Date(2026, 10, 16, 9, 0).getTime())
})

test("a picked time must parse and lie in the future, and the label says which day it wakes", () => {
  expect(parseSnoozeInput("2026-11-08T09:30", SATURDAY_10AM)).toBe(new Date(2026, 10, 8, 9, 30).getTime())
  expect(parseSnoozeInput("2026-11-07T09:30", SATURDAY_10AM)).toBeNull()
  expect(parseSnoozeInput("", SATURDAY_10AM)).toBeNull()
  expect(formatSnoozeUntil(new Date(2026, 10, 8, 9, 0).getTime(), SATURDAY_10AM)).toContain("tomorrow")
})
