import { expect, test } from "bun:test"
import { computeVariance, formatMetricValue } from "./index"

test("formats currency compactly for headline figures", () => {
  expect(formatMetricValue(1_250_000, { format: "currency", currency: "USD" }, { compact: true })).toBe("$1.25M")
  expect(formatMetricValue(420_000, { format: "currency", currency: "EUR" }, { compact: true })).toBe("€420K")
})

test("formats statement lines with accounting negatives and no currency symbol", () => {
  expect(formatMetricValue(-125_000, { format: "currency", currency: "USD" }, { accounting: true })).toBe("(125,000)")
  expect(formatMetricValue(12_800_000, { format: "currency", currency: "USD" }, { accounting: true })).toBe("12,800,000")
})

test("formats a ratio metric as a percentage and a missing value as a dash", () => {
  expect(formatMetricValue(0.142, { format: "percent" })).toBe("14.2%")
  expect(formatMetricValue(null, { format: "percent" })).toBe("—")
})

test("reports a change in a percentage metric in basis points", () => {
  const variance = computeVariance(0.174, 0.142, { format: "percent" })
  expect([variance.amountText, variance.trend, variance.sentiment]).toEqual(["+320 bps", "up", "positive"])
})

test("treats a fall as good news for a metric where lower is better", () => {
  const variance = computeVariance(80, 100, { format: "currency", currency: "USD" }, "lower-is-better")
  expect([variance.amountText, variance.ratioText, variance.sentiment]).toEqual(["−$20", "−20.0%", "positive"])
})
