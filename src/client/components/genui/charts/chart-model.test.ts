import { expect, test } from "bun:test"
import { datasetDeclSchema, runDatasetQuery, type DatasetDecl, type DatasetQuery, type QueryResult } from "../../../../shared/genui"
import type { JsonObject } from "../../../../shared/json"
import { buildChartModel, type ChartModel, type ChartRequest } from "./chart-model"
import type { ChartTheme } from "./chart-theme"
import { BAR_MAX_WIDTH, buildVChartSpec, seriesColor } from "./vchart-spec"

const DECL: DatasetDecl = datasetDeclSchema.parse({
  source: "inline",
  rows: [],
  metrics: { revenue: { format: "currency" }, margin: { format: "percent" }, cost: { format: "currency" } },
  dimensions: { month: { kind: "time", grain: "month" }, customer: {}, step: { order: ["Revenue", "COGS", "Opex"] } },
})

const THEME: ChartTheme = {
  series: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"],
  compare: "muted",
  increase: "s1",
  decrease: "s8",
  total: "muted",
  grid: "grid",
  axis: "axis",
  text: "text",
  mutedText: "muted",
  surface: "surface",
  fontFamily: "Body",
}

function result(rows: readonly JsonObject[], query: DatasetQuery): QueryResult {
  const outcome = runDatasetQuery(DECL, rows, query)
  if (!outcome.ok) throw new Error(outcome.message)
  return outcome.result
}

function model(request: ChartRequest, rows: readonly JsonObject[], query: DatasetQuery): ChartModel {
  const built = buildChartModel(request, DECL, result(rows, query))
  if (!built.ok) throw new Error(built.message)
  return built.model
}

const SALES = [
  { month: "2026-07", customer: "Acme", revenue: 100, cost: 60 },
  { month: "2026-08", customer: "Acme", revenue: 120, cost: 70 },
  { month: "2026-08", customer: "Globex", revenue: 40, cost: 30 },
  { month: "2026-08", customer: "Initech", revenue: 10, cost: 5 },
]

test("refuses to put two units on one chart instead of drawing a second axis", () => {
  const built = buildChartModel({ chart: "combo", metrics: ["revenue"], secondaryMetric: "margin", dimension: "month" }, DECL, result(SALES, { metrics: ["revenue", "margin"], groupBy: ["month"] }))
  expect(built.ok).toBe(false)
})

test("a waterfall walks each step from the previous running total and closes with a total bar", () => {
  const steps = [{ step: "Revenue", revenue: 100 }, { step: "COGS", revenue: -40 }, { step: "Opex", revenue: -25 }]
  const built = model({ chart: "waterfall", metrics: ["revenue"], dimension: "step", totalLabel: "EBITDA" }, steps, { metrics: ["revenue"], groupBy: ["step"], sort: { by: "step" } })
  expect(built.points.map((point) => [point.x, point.series, point.start, point.end])).toEqual([
    ["Revenue", "increase", 0, 100],
    ["COGS", "decrease", 100, 60],
    ["Opex", "decrease", 60, 35],
    ["EBITDA", "total", 0, 35],
  ])
})

test("a series keeps its colour when a filter removes another series", () => {
  const request: ChartRequest = { chart: "bar", metrics: ["revenue"], dimension: "month", series: "customer" }
  const colours = (rows: readonly JsonObject[]) => {
    const built = model(request, rows, { metrics: ["revenue"], groupBy: ["month", "customer"] })
    return Object.fromEntries(built.series.map((series) => [series.id, seriesColor(series, THEME)]))
  }
  const all = colours(SALES)
  const withoutInitech = colours(SALES.filter((row) => row.customer !== "Initech"))
  expect(withoutInitech).toEqual({ Acme: all.Acme, Globex: all.Globex })
})

test("a part-to-whole chart folds the tail into Other and refuses negative slices", () => {
  const many = ["a", "b", "c", "d", "e", "f", "g", "h"].map((customer, index) => ({ month: "2026-08", customer, revenue: 10 + index }))
  const built = model({ chart: "composition", metrics: ["revenue"], dimension: "customer" }, many, { metrics: ["revenue"], groupBy: ["customer"] })
  expect(built.series.map((series) => series.id)).toEqual(["d", "e", "f", "g", "h", "Other"])

  const negative = buildChartModel({ chart: "composition", metrics: ["revenue"], dimension: "customer" }, DECL, result([{ customer: "a", revenue: -5 }], { metrics: ["revenue"], groupBy: ["customer"] }))
  expect(negative.ok).toBe(false)
})

test("a comparison is drawn as a muted dashed series and a single series gets no legend", () => {
  const compared = model({ chart: "line", metrics: ["revenue"], dimension: "month" }, SALES, { metrics: ["revenue"], groupBy: ["month"], period: "2026-08", compare: "previous-period" })
  const spec = buildVChartSpec(compared, THEME)
  expect(compared.series.map((series) => [series.role, seriesColor(series, THEME)])).toEqual([["series", "s1"], ["compare", "muted"]])
  expect(spec.legends).toMatchObject({ visible: true })

  const single = buildVChartSpec(model({ chart: "line", metrics: ["revenue"], dimension: "month" }, SALES, { metrics: ["revenue"], groupBy: ["month"] }), THEME)
  expect(single.legends).toMatchObject({ visible: false })
})

test("bars are capped at the documented width and rounded only at the data end", () => {
  const spec = buildVChartSpec(model({ chart: "bar", metrics: ["revenue"], dimension: "month" }, SALES, { metrics: ["revenue"], groupBy: ["month"] }), THEME)
  expect(spec).toMatchObject({ type: "bar", barMaxWidth: BAR_MAX_WIDTH, bar: { style: { cornerRadius: [4, 4, 0, 0] } } })
})
