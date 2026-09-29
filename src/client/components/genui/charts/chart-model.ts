import {
  bucketLabel,
  dimensionLabel,
  metricLabel,
  valueFormatOf,
  type DatasetDecl,
  type QueryResult,
  type QueryRow,
  type ValueFormat,
} from "../../../../shared/genui"

export type ChartKind = "line" | "bar" | "area" | "stacked-bar" | "waterfall" | "combo" | "composition"
export type SeriesRole = "series" | "compare" | "secondary" | "increase" | "decrease" | "total"

export const CATEGORICAL_SLOTS = 8
export const COMPOSITION_MAX_SLICES = 6
export const OTHER_SERIES = "Other"

export interface ChartSeries {
  id: string
  label: string
  role: SeriesRole
  slot: number | null
}

export interface ChartPoint {
  x: string
  xLabel: string
  series: string
  value: number
  start?: number
  end?: number
}

export interface ChartModel {
  kind: ChartKind
  points: ChartPoint[]
  series: ChartSeries[]
  xOrder: string[]
  xLabels: Record<string, string>
  format: ValueFormat
  valueLabel: string
  dimensionLabel: string
}

export interface ChartRequest {
  chart: ChartKind
  metrics: readonly string[]
  secondaryMetric?: string
  dimension: string
  series?: string
  totalLabel?: string
}

export type ChartModelResult = { ok: true; model: ChartModel } | { ok: false; message: string }

function sameAxis(decl: DatasetDecl, metrics: readonly string[]): boolean {
  const formats = metrics.map((id) => valueFormatOf(decl.metrics[id]))
  const [first] = formats
  return formats.every((format) => format.format === first?.format && format.currency === first?.currency)
}

function xLabelOf(decl: DatasetDecl, dimension: string, result: QueryResult, key: string): string {
  const def = decl.dimensions?.[dimension]
  return def?.kind === "time" ? bucketLabel(key, result.grain ?? def.grain ?? "month") : key
}

function orderedKeys(rows: readonly QueryRow[], dimension: string): string[] {
  const seen: string[] = []
  for (const row of rows) {
    const key = row.dimensions[dimension]
    if (key !== undefined && !seen.includes(key)) seen.push(key)
  }
  return seen
}

function stableSeriesOrder(decl: DatasetDecl, dimension: string, values: readonly string[]): string[] {
  const order = decl.dimensions?.[dimension]?.order
  return [...values].sort((left, right) => {
    const leftIndex = order ? order.indexOf(left) : -1
    const rightIndex = order ? order.indexOf(right) : -1
    if (leftIndex !== rightIndex) {
      if (leftIndex === -1) return 1
      if (rightIndex === -1) return -1
      return leftIndex - rightIndex
    }
    return left.localeCompare(right, "en", { numeric: true })
  })
}

function foldSeries(rows: readonly QueryRow[], seriesDimension: string, metric: string, keep: number): Set<string> {
  const totals = new Map<string, number>()
  for (const row of rows) {
    const key = row.dimensions[seriesDimension] ?? ""
    totals.set(key, (totals.get(key) ?? 0) + Math.abs(row.values[metric] ?? 0))
  }
  const ranked = [...totals.entries()].sort((left, right) => right[1] - left[1]).map(([key]) => key)
  return new Set(ranked.length > keep + 1 ? ranked.slice(0, keep) : ranked)
}

function base(request: ChartRequest, decl: DatasetDecl, result: QueryResult, metric: string): Omit<ChartModel, "points" | "series"> {
  const xOrder = orderedKeys(result.rows, request.dimension)
  return {
    kind: request.chart,
    xOrder,
    xLabels: Object.fromEntries(xOrder.map((key) => [key, xLabelOf(decl, request.dimension, result, key)])),
    format: valueFormatOf(decl.metrics[metric]),
    valueLabel: metricLabel(metric, decl.metrics[metric]),
    dimensionLabel: dimensionLabel(request.dimension, decl.dimensions?.[request.dimension]),
  }
}

export function buildChartModel(request: ChartRequest, decl: DatasetDecl, result: QueryResult): ChartModelResult {
  const [primary] = request.metrics
  if (!primary) return { ok: false, message: "A chart needs a metric" }
  const allMetrics = [...request.metrics, ...(request.secondaryMetric ? [request.secondaryMetric] : [])]
  if (!sameAxis(decl, allMetrics)) {
    return { ok: false, message: "These metrics use different units, and a chart has one axis. Show them in two charts." }
  }
  switch (request.chart) {
    case "waterfall":
      return waterfall(request, decl, result, primary)
    case "composition":
      return composition(request, decl, result, primary)
    case "combo":
      return combo(request, decl, result, primary)
    default:
      return cartesian(request, decl, result)
  }
}

function cartesian(request: ChartRequest, decl: DatasetDecl, result: QueryResult): ChartModelResult {
  const [primary = ""] = request.metrics
  if (request.chart === "stacked-bar" && !request.series && request.metrics.length < 2) {
    return { ok: false, message: "A stacked bar needs a series dimension or at least two metrics to stack" }
  }
  if (request.series && request.metrics.length > 1) {
    return { ok: false, message: "Split by a series dimension with one metric, or list several metrics without a series" }
  }
  const model = base(request, decl, result, primary)
  const points: ChartPoint[] = []
  const series: ChartSeries[] = []

  if (request.series) {
    const seriesDimension = request.series
    const kept = foldSeries(result.rows, seriesDimension, primary, CATEGORICAL_SLOTS - 1)
    const ids = stableSeriesOrder(decl, seriesDimension, [...kept])
    const folded = orderedKeys(result.rows, seriesDimension).some((key) => !kept.has(key))
    ids.forEach((id, index) => series.push({ id, label: id, role: "series", slot: index }))
    if (folded) series.push({ id: OTHER_SERIES, label: OTHER_SERIES, role: "series", slot: ids.length })
    const sums = new Map<string, number>()
    for (const row of result.rows) {
      const x = row.dimensions[request.dimension]
      const raw = row.dimensions[seriesDimension] ?? ""
      const value = row.values[primary]
      if (x === undefined || value === null || value === undefined) continue
      const id = kept.has(raw) ? raw : OTHER_SERIES
      const key = `${x}\u0001${id}`
      sums.set(key, (sums.get(key) ?? 0) + value)
    }
    for (const [key, value] of sums) {
      const [x = "", id = ""] = key.split("\u0001")
      points.push({ x, xLabel: model.xLabels[x] ?? x, series: id, value })
    }
    return { ok: true, model: { ...model, points, series } }
  }

  request.metrics.forEach((metric, index) => {
    series.push({ id: metric, label: metricLabel(metric, decl.metrics[metric]), role: "series", slot: index })
  })
  if (result.comparison) {
    request.metrics.forEach((metric) => {
      series.push({ id: `${metric}::compare`, label: `${metricLabel(metric, decl.metrics[metric])} (${result.comparison?.label})`, role: "compare", slot: null })
    })
  }
  for (const row of result.rows) {
    const x = row.dimensions[request.dimension]
    if (x === undefined) continue
    for (const metric of request.metrics) {
      const value = row.values[metric]
      if (value !== null && value !== undefined) points.push({ x, xLabel: model.xLabels[x] ?? x, series: metric, value })
      const compare = row.compare?.[metric]
      if (compare !== null && compare !== undefined) points.push({ x, xLabel: model.xLabels[x] ?? x, series: `${metric}::compare`, value: compare })
    }
  }
  return { ok: true, model: { ...model, points, series } }
}

function combo(request: ChartRequest, decl: DatasetDecl, result: QueryResult, primary: string): ChartModelResult {
  if (!request.secondaryMetric) return { ok: false, message: "A combo chart needs a secondaryMetric drawn as a line over the bars" }
  const secondary = request.secondaryMetric
  const model = base(request, decl, result, primary)
  const points: ChartPoint[] = []
  for (const row of result.rows) {
    const x = row.dimensions[request.dimension]
    if (x === undefined) continue
    const bar = row.values[primary]
    const line = row.values[secondary]
    if (bar !== null && bar !== undefined) points.push({ x, xLabel: model.xLabels[x] ?? x, series: primary, value: bar })
    if (line !== null && line !== undefined) points.push({ x, xLabel: model.xLabels[x] ?? x, series: secondary, value: line })
  }
  return {
    ok: true,
    model: {
      ...model,
      points,
      series: [
        { id: primary, label: metricLabel(primary, decl.metrics[primary]), role: "series", slot: 0 },
        { id: secondary, label: metricLabel(secondary, decl.metrics[secondary]), role: "secondary", slot: 1 },
      ],
    },
  }
}

function waterfall(request: ChartRequest, decl: DatasetDecl, result: QueryResult, primary: string): ChartModelResult {
  if (request.series) return { ok: false, message: "A waterfall shows one metric; drop the series dimension" }
  const model = base(request, decl, result, primary)
  const points: ChartPoint[] = []
  let running = 0
  for (const row of result.rows) {
    const x = row.dimensions[request.dimension]
    const value = row.values[primary]
    if (x === undefined || value === null || value === undefined) continue
    const start = running
    running += value
    points.push({ x, xLabel: model.xLabels[x] ?? x, series: value >= 0 ? "increase" : "decrease", value, start, end: running })
  }
  const totalLabel = request.totalLabel ?? "Total"
  points.push({ x: totalLabel, xLabel: totalLabel, series: "total", value: running, start: 0, end: running })
  return {
    ok: true,
    model: {
      ...model,
      points,
      xOrder: [...points.map((point) => point.x)],
      xLabels: { ...model.xLabels, [totalLabel]: totalLabel },
      series: [
        { id: "increase", label: "Increase", role: "increase", slot: null },
        { id: "decrease", label: "Decrease", role: "decrease", slot: null },
        { id: "total", label: totalLabel, role: "total", slot: null },
      ],
    },
  }
}

function composition(request: ChartRequest, decl: DatasetDecl, result: QueryResult, primary: string): ChartModelResult {
  const model = base(request, decl, result, primary)
  const slices = result.rows
    .map((row) => ({ key: row.dimensions[request.dimension] ?? "", value: row.values[primary] ?? 0 }))
    .filter((slice) => slice.value !== 0)
  if (slices.some((slice) => slice.value < 0)) {
    return { ok: false, message: "A part-to-whole chart cannot show negative values; use a bar chart" }
  }
  const ranked = [...slices].sort((left, right) => right.value - left.value)
  const kept = ranked.length > COMPOSITION_MAX_SLICES ? ranked.slice(0, COMPOSITION_MAX_SLICES - 1) : ranked
  const rest = ranked.slice(kept.length).reduce((total, slice) => total + slice.value, 0)
  const ids = stableSeriesOrder(decl, request.dimension, kept.map((slice) => slice.key))
  const values = new Map(kept.map((slice) => [slice.key, slice.value]))
  const series: ChartSeries[] = ids.map((id, index) => ({ id, label: model.xLabels[id] ?? id, role: "series", slot: index }))
  const points: ChartPoint[] = ids.map((id) => ({ x: id, xLabel: model.xLabels[id] ?? id, series: id, value: values.get(id) ?? 0 }))
  if (rest > 0) {
    series.push({ id: OTHER_SERIES, label: OTHER_SERIES, role: "series", slot: ids.length })
    points.push({ x: OTHER_SERIES, xLabel: OTHER_SERIES, series: OTHER_SERIES, value: rest })
  }
  return { ok: true, model: { ...model, points, series, xOrder: points.map((point) => point.x) } }
}
