import { describe, expect, test } from "bun:test"
import type { TranscriptEntry } from "../shared/types"
import {
  fitLimitToByteBudget,
  MIN_RECENT_PAGE_ENTRIES,
  RECENT_PAGE_BYTE_BUDGET,
} from "./event-store-helpers"

function entryOfSize(id: number, bytes: number): TranscriptEntry {
  return {
    _id: `e${id}`,
    createdAt: id,
    kind: "assistant_text",
    text: "x".repeat(Math.max(0, bytes - 60)),
  } as unknown as TranscriptEntry
}

const lean = (count: number) => Array.from({ length: count }, (_, i) => entryOfSize(i, 100))
const fat = (count: number) => Array.from({ length: count }, (_, i) => entryOfSize(i, 50_000))

describe("fitLimitToByteBudget", () => {
  test("leaves a lean page at the full entry limit", () => {
    expect(fitLimitToByteBudget(lean(500), 200)).toBe(200)
  })

  test("trims a fat page to fit the byte budget", () => {
    const fitted = fitLimitToByteBudget(fat(200), 200)
    expect(fitted).toBeLessThan(200)
    expect(fitted).toBeGreaterThanOrEqual(MIN_RECENT_PAGE_ENTRIES)
  })

  test("keeps the fitted page within the budget", () => {
    const entries = fat(200)
    const fitted = fitLimitToByteBudget(entries, 200)
    const shipped = entries.slice(entries.length - fitted)
    const bytes = shipped.reduce((sum, e) => sum + JSON.stringify(e).length, 0)
    expect(bytes).toBeLessThanOrEqual(RECENT_PAGE_BYTE_BUDGET)
  })

  test("never ships fewer than the minimum, even when every entry blows the budget", () => {
    const huge = Array.from({ length: 50 }, (_, i) => entryOfSize(i, 2_000_000))
    expect(fitLimitToByteBudget(huge, 200)).toBe(MIN_RECENT_PAGE_ENTRIES)
  })

  test("never returns more entries than exist", () => {
    expect(fitLimitToByteBudget(lean(5), 200)).toBe(5)
    expect(fitLimitToByteBudget(fat(3), 200)).toBe(3)
  })

  test("passes degenerate inputs straight through", () => {
    expect(fitLimitToByteBudget([], 200)).toBe(200)
    expect(fitLimitToByteBudget(lean(10), 0)).toBe(0)
    expect(fitLimitToByteBudget(lean(10), 200, 0)).toBe(200)
  })

  test("selects the NEWEST entries, not the oldest", () => {
    const entries = [...fat(50), ...lean(50)]
    const fitted = fitLimitToByteBudget(entries, 200)
    expect(fitted).toBeGreaterThanOrEqual(50)
  })
})
