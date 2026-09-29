import { expect, test } from "bun:test"
import type { JsonObject } from "../json"
import { datasetDeclSchema, runDatasetQuery, type DatasetDecl, type DatasetQuery, type QueryResult } from "./index"

const PNL: DatasetDecl = datasetDeclSchema.parse({
  source: "inline",
  rows: [],
  metrics: {
    revenue: { format: "currency" },
    gross_profit: { format: "currency" },
    gross_margin: { format: "percent", derived: { op: "ratio", of: ["gross_profit", "revenue"] } },
    cash: { format: "currency", aggregate: "last" },
  },
  dimensions: { month: { kind: "time", grain: "month" }, customer: {} },
  scenario: { column: "scenario", actual: "Actual", budget: "Budget" },
})

function row(month: string, customer: string, revenue: number | string, extra: JsonObject = {}): JsonObject {
  return { month, customer, scenario: "Actual", revenue, gross_profit: typeof revenue === "number" ? revenue / 2 : 0, cash: 0, ...extra }
}

const ROWS: JsonObject[] = [
  row("2025-08", "Acme", 80),
  row("2025-09", "Acme", 90),
  row("2026-07", "Acme", 100),
  row("2026-08", "Acme", 120),
  row("2026-08", "Globex", 30),
  { month: "2026-08", customer: "Acme", scenario: "Budget", revenue: 140, gross_profit: 70, cash: 0 },
]

function run(query: DatasetQuery, rows: readonly JsonObject[] = ROWS, decl: DatasetDecl = PNL): QueryResult {
  const outcome = runDatasetQuery(decl, rows, query)
  if (!outcome.ok) throw new Error(outcome.message)
  return outcome.result
}

test("anchors a relative period on the latest date in the data, not on the clock", () => {
  const result = run({ metrics: ["revenue"], groupBy: ["month"], period: "last-2-months" })
  expect(result.rows.map((r) => [r.dimensions.month, r.values.revenue])).toEqual([["2026-07", 100], ["2026-08", 150]])
  expect(result.period.label).toBe("Jul 2026 – Aug 2026")
})

test("aligns the prior year onto the same months for a year-over-year comparison", () => {
  const result = run({ metrics: ["revenue"], groupBy: ["month"], period: "2026-08", compare: "previous-year" })
  expect(result.rows).toEqual([{ key: "2026-08", dimensions: { month: "2026-08" }, values: { revenue: 150 }, compare: { revenue: 80 } }])
  expect(result.comparison?.label).toBe("Prior year (Aug 2025)")
})

test("compares actuals with budget through the scenario column", () => {
  const result = run({ metrics: ["revenue"], period: "2026-08", compare: "budget" })
  expect(result.totals).toEqual({ values: { revenue: 150 }, compare: { revenue: 140 } })
})

test("computes a ratio metric after aggregation, not as a sum of row ratios", () => {
  const rows = [row("2026-08", "Acme", 100, { gross_profit: 90 }), row("2026-08", "Globex", 300, { gross_profit: 30 })]
  expect(run({ metrics: ["gross_margin"] }, rows).totals.values.gross_margin).toBe(0.3)
})

test("takes a balance at the latest date of each group instead of summing it over time", () => {
  const rows = [row("2026-07", "Acme", 0, { cash: 500 }), row("2026-08", "Acme", 0, { cash: 700 }), row("2026-08", "Globex", 0, { cash: 50 })]
  expect(run({ metrics: ["cash"] }, rows).totals.values.cash).toBe(750)
})

test("drills one month down by customer with a filter", () => {
  const result = run({ metrics: ["revenue"], groupBy: ["customer"], filters: [{ dimension: "month", value: "2026-08" }] })
  expect(result.rows.map((r) => [r.dimensions.customer, r.values.revenue])).toEqual([["Acme", 120], ["Globex", 30]])
})

test("reads accounting-formatted numbers, with parentheses as negatives", () => {
  const rows = [row("2026-08", "Acme", "$1,200.50"), row("2026-08", "Globex", "(200.50)")]
  expect(run({ metrics: ["revenue"] }, rows).totals.values.revenue).toBe(1000)
})

test("marks a result truncated when groups exceed the limit", () => {
  const result = run({ metrics: ["revenue"], groupBy: ["customer"], limit: 1 })
  expect({ rows: result.rows.length, truncated: result.truncated }).toEqual({ rows: 1, truncated: true })
})

test("rejects a query naming a metric the dataset does not declare", () => {
  const outcome = runDatasetQuery(PNL, ROWS, { metrics: ["ebitda"] })
  expect(outcome.ok ? null : outcome.code).toBe("invalid_query")
})

test("refuses a budget comparison when the dataset declares no budget scenario", () => {
  const decl = datasetDeclSchema.parse({ source: "inline", rows: [], metrics: { revenue: {} }, dimensions: { month: { kind: "time" } } })
  const outcome = runDatasetQuery(decl, ROWS, { metrics: ["revenue"], compare: "budget" })
  expect(outcome.ok ? null : outcome.code).toBe("invalid_query")
})
