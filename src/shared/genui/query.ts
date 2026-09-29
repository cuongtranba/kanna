import { z } from "zod"
import type { JsonObject, JsonValue } from "../json"
import {
  GENUI_IDENTIFIER,
  TIME_GRAINS,
  dimensionColumn,
  metricColumn,
  timeDimensionOf,
  type DatasetDecl,
  type DimensionDef,
  type MetricDef,
  type TimeGrain,
} from "./datasets"
import {
  bucketKey,
  comparisonShift,
  dayIndex,
  describeWindow,
  parseTimeValue,
  resolvePeriod,
  shiftPoint,
  shiftWindow,
  windowContains,
  type CompareMode,
  type ComparisonShift,
  type PeriodWindow,
  type TimePoint,
} from "./period"

export const QUERY_DEFAULT_LIMIT = 200
export const QUERY_MAX_LIMIT = 1000
export const COMPARE_MODES = ["previous-period", "previous-year", "budget", "forecast"] as const
export const SCENARIOS = ["actual", "budget", "forecast"] as const

const identifier = z.string().regex(GENUI_IDENTIFIER)

export const periodSpecSchema = z.union([
  z.string().min(1).max(40),
  z.strictObject({ from: z.string().min(4).max(20), to: z.string().min(4).max(20) }),
])

export const datasetFilterSchema = z.strictObject({
  dimension: identifier,
  op: z.enum(["eq", "neq", "in", "not-in"]).optional(),
  value: z.union([z.string().max(200), z.number(), z.array(z.union([z.string().max(200), z.number()])).max(100)]),
})

export const datasetQuerySchema = z.strictObject({
  metrics: z.array(identifier).min(1).max(12),
  groupBy: z.array(identifier).max(3).optional(),
  filters: z.array(datasetFilterSchema).max(12).optional(),
  period: periodSpecSchema.optional(),
  timeDimension: identifier.optional(),
  grain: z.enum(TIME_GRAINS).optional(),
  compare: z.enum(COMPARE_MODES).optional(),
  scenario: z.enum(SCENARIOS).optional(),
  sort: z.strictObject({ by: identifier, direction: z.enum(["asc", "desc"]).optional() }).optional(),
  limit: z.number().int().min(1).max(QUERY_MAX_LIMIT).optional(),
})

export type DatasetFilter = z.output<typeof datasetFilterSchema>
export type DatasetQuery = z.output<typeof datasetQuerySchema>
export type Scenario = (typeof SCENARIOS)[number]

export type MetricValues = Record<string, number | null>

export interface QueryRow {
  key: string
  dimensions: Record<string, string>
  values: MetricValues
  compare?: MetricValues
}

export interface QueryResult {
  rows: QueryRow[]
  totals: { values: MetricValues; compare?: MetricValues }
  period: { label: string; window: PeriodWindow | null }
  comparison?: { mode: CompareMode; label: string }
  timeDimension: string | null
  grain: TimeGrain | null
  truncated: boolean
  sourceRowCount: number
}

export type QueryErrorCode = "invalid_query" | "no_data"

export type QueryOutcome =
  | { ok: true; result: QueryResult }
  | { ok: false; code: QueryErrorCode; message: string }

interface PreparedRow {
  source: JsonObject
  time: TimePoint | null
  scenario: string | null
}

interface QueryPlan {
  decl: DatasetDecl
  metrics: readonly string[]
  baseMetrics: readonly string[]
  groupBy: readonly string[]
  timeDimension: string | null
  grain: TimeGrain | null
}

const BLANK = "(blank)"
const KEY_SEPARATOR = "\u0001"

export function parseNumeric(raw: JsonValue | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  if (trimmed === "") return null
  const negativeParens = /^\(.*\)$/.test(trimmed)
  const cleaned = trimmed.replace(/[()\s,]/g, "").replace(/^[^\d.+-]+/, "").replace(/%$/, "")
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(cleaned)) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  return negativeParens ? -Math.abs(value) : value
}

export function dimensionValue(raw: JsonValue | undefined): string {
  if (raw === undefined || raw === null || raw === "") return BLANK
  if (typeof raw === "string") return raw
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw)
  return JSON.stringify(raw)
}

export function runDatasetQuery(decl: DatasetDecl, rows: readonly JsonObject[], query: DatasetQuery): QueryOutcome {
  const planned = plan(decl, query)
  if (!planned.ok) return planned
  const { value: queryPlan } = planned
  const prepared = rows.map((row) => prepareRow(decl, queryPlan.timeDimension, row))
  const primaryScenario = scenarioValue(decl, query.scenario ?? "actual")
  const anchor = latestTime(prepared.filter((row) => primaryScenario === null || row.scenario === primaryScenario))
  const period = resolvePeriod(query.period, anchor, decl.fiscalYearStartMonth)
  if (!period.ok) return { ok: false, code: "invalid_query", message: period.message }
  if (period.window && !queryPlan.timeDimension) {
    return { ok: false, code: "invalid_query", message: "a period needs a time dimension; declare one with kind \"time\"" }
  }

  const filtered = prepared.filter((row) => matchesFilters(decl, row.source, query.filters ?? []))
  const inPrimary = (row: PreparedRow) =>
    (primaryScenario === null || row.scenario === primaryScenario)
    && (period.window === null || (row.time !== null && windowContains(period.window, row.time)))
  const primaryRows = filtered.filter(inPrimary)

  const comparison = query.compare ? compareRows(decl, filtered, query.compare, period.window) : null
  if (comparison && !comparison.ok) return comparison

  const groups = aggregateGroups(queryPlan, primaryRows, { months: 0, days: 0 })
  const compareGroups = comparison?.ok ? aggregateGroups(queryPlan, comparison.rows, comparison.alignShift) : null
  const merged = mergeGroups(queryPlan, groups, compareGroups)
  const sorted = sortRows(queryPlan, merged, query.sort)
  const limit = query.limit ?? QUERY_DEFAULT_LIMIT

  return {
    ok: true,
    result: {
      rows: sorted.slice(0, limit),
      totals: {
        values: aggregateMetrics(queryPlan, primaryRows),
        ...(comparison?.ok ? { compare: aggregateMetrics(queryPlan, comparison.rows) } : {}),
      },
      period: { label: describeWindow(period.window), window: period.window },
      ...(comparison?.ok && query.compare ? { comparison: { mode: query.compare, label: comparison.label } } : {}),
      timeDimension: queryPlan.timeDimension,
      grain: queryPlan.grain,
      truncated: sorted.length > limit,
      sourceRowCount: rows.length,
    },
  }
}

function plan(decl: DatasetDecl, query: DatasetQuery): { ok: true; value: QueryPlan } | { ok: false; code: QueryErrorCode; message: string } {
  const dimensions = decl.dimensions ?? {}
  for (const metric of query.metrics) {
    if (!decl.metrics[metric]) return invalid(`unknown metric "${metric}"; declared: ${Object.keys(decl.metrics).join(", ")}`)
  }
  for (const dimension of [...(query.groupBy ?? []), ...(query.filters ?? []).map((filter) => filter.dimension)]) {
    if (!dimensions[dimension]) return invalid(`unknown dimension "${dimension}"; declared: ${Object.keys(dimensions).join(", ") || "none"}`)
  }
  if (query.timeDimension && dimensions[query.timeDimension]?.kind !== "time") {
    return invalid(`"${query.timeDimension}" is not a time dimension`)
  }
  if (query.sort && !decl.metrics[query.sort.by] && !dimensions[query.sort.by]) {
    return invalid(`cannot sort by unknown field "${query.sort.by}"`)
  }
  if ((query.compare === "budget" || query.compare === "forecast") && !decl.scenario?.[query.compare]) {
    return invalid(`comparing with ${query.compare} needs a scenario column whose ${query.compare} value is declared`)
  }
  if (query.scenario && query.scenario !== "actual" && !decl.scenario?.[query.scenario]) {
    return invalid(`scenario "${query.scenario}" is not declared on this dataset`)
  }
  const groupBy = query.groupBy ?? []
  const timeInGroup = groupBy.find((dimension) => dimensions[dimension]?.kind === "time")
  const timeDimension = timeInGroup ?? timeDimensionOf(decl, query.timeDimension)
  const grain = timeDimension ? query.grain ?? dimensions[timeDimension]?.grain ?? "month" : null
  return {
    ok: true,
    value: { decl, metrics: query.metrics, baseMetrics: baseMetricsOf(decl, query.metrics), groupBy, timeDimension, grain },
  }
}

function invalid(message: string): { ok: false; code: QueryErrorCode; message: string } {
  return { ok: false, code: "invalid_query", message }
}

function baseMetricsOf(decl: DatasetDecl, metrics: readonly string[]): string[] {
  const base = new Set<string>()
  for (const id of metrics) {
    const metric = decl.metrics[id]
    if (metric?.derived) metric.derived.of.forEach((ref) => base.add(ref))
    else base.add(id)
  }
  return [...base]
}

function prepareRow(decl: DatasetDecl, timeDimension: string | null, source: JsonObject): PreparedRow {
  const timeDef = timeDimension ? decl.dimensions?.[timeDimension] : undefined
  const time = timeDimension && timeDef ? parseTimeValue(source[dimensionColumn(timeDimension, timeDef)] ?? null) : null
  const scenario = decl.scenario ? dimensionValue(source[decl.scenario.column]) : null
  return { source, time, scenario }
}

function scenarioValue(decl: DatasetDecl, scenario: "actual" | "budget" | "forecast"): string | null {
  if (!decl.scenario) return null
  return decl.scenario[scenario] ?? null
}

function latestTime(rows: readonly PreparedRow[]): TimePoint | null {
  let latest: TimePoint | null = null
  for (const row of rows) {
    if (row.time && (!latest || dayIndex(row.time) > dayIndex(latest))) latest = row.time
  }
  return latest
}

function matchesFilters(decl: DatasetDecl, row: JsonObject, filters: readonly DatasetFilter[]): boolean {
  return filters.every((filter) => {
    const def = decl.dimensions?.[filter.dimension]
    if (!def) return false
    const actual = dimensionValue(row[dimensionColumn(filter.dimension, def)])
    const expected = Array.isArray(filter.value) ? filter.value.map(String) : [String(filter.value)]
    const op = filter.op ?? (Array.isArray(filter.value) ? "in" : "eq")
    const hit = expected.includes(actual)
    return op === "eq" || op === "in" ? hit : !hit
  })
}

type ComparisonRows =
  | { ok: true; rows: PreparedRow[]; alignShift: ComparisonShift; label: string }
  | { ok: false; code: QueryErrorCode; message: string }

function compareRows(decl: DatasetDecl, rows: readonly PreparedRow[], mode: CompareMode, window: PeriodWindow | null): ComparisonRows {
  if (mode === "budget" || mode === "forecast") {
    const scenario = scenarioValue(decl, mode)
    return {
      ok: true,
      rows: rows.filter((row) => row.scenario === scenario && (window === null || (row.time !== null && windowContains(window, row.time)))),
      alignShift: { months: 0, days: 0 },
      label: mode === "budget" ? "Budget" : "Forecast",
    }
  }
  if (!window) return invalid(`comparing with the ${mode} needs a period, such as last-12-months`)
  const shift = comparisonShift(window, mode)
  const compareWindow = shiftWindow(window, shift)
  const actual = scenarioValue(decl, "actual")
  return {
    ok: true,
    rows: rows.filter((row) => (actual === null || row.scenario === actual) && row.time !== null && windowContains(compareWindow, row.time)),
    alignShift: { months: -shift.months, days: -shift.days },
    label: mode === "previous-year" ? `Prior year (${describeWindow(compareWindow)})` : `Prior period (${describeWindow(compareWindow)})`,
  }
}

interface Group {
  dimensions: Record<string, string>
  rows: PreparedRow[]
}

function groupKeyOf(queryPlan: QueryPlan, row: PreparedRow, align: ComparisonShift): { key: string; dimensions: Record<string, string> } | null {
  const dimensions: Record<string, string> = {}
  for (const id of queryPlan.groupBy) {
    const def = queryPlan.decl.dimensions?.[id]
    if (!def) return null
    if (def.kind === "time") {
      const time = id === queryPlan.timeDimension ? row.time : parseTimeValue(row.source[dimensionColumn(id, def)] ?? null)
      if (!time) return null
      const aligned = align.months === 0 && align.days === 0 ? time : shiftPoint(time, align.months, align.days)
      dimensions[id] = bucketKey(aligned, queryPlan.grain ?? def.grain ?? "month")
    } else {
      dimensions[id] = dimensionValue(row.source[dimensionColumn(id, def)])
    }
  }
  return { key: queryPlan.groupBy.map((id) => dimensions[id]).join(KEY_SEPARATOR), dimensions }
}

function aggregateGroups(queryPlan: QueryPlan, rows: readonly PreparedRow[], align: ComparisonShift): Map<string, Group> {
  const groups = new Map<string, Group>()
  for (const row of rows) {
    const grouped = groupKeyOf(queryPlan, row, align)
    if (!grouped) continue
    const existing = groups.get(grouped.key)
    if (existing) existing.rows.push(row)
    else groups.set(grouped.key, { dimensions: grouped.dimensions, rows: [row] })
  }
  return groups
}

function aggregateMetrics(queryPlan: QueryPlan, rows: readonly PreparedRow[]): MetricValues {
  const base: MetricValues = {}
  for (const id of queryPlan.baseMetrics) {
    const metric = queryPlan.decl.metrics[id]
    base[id] = metric ? aggregateMetric(id, metric, rows) : null
  }
  const values: MetricValues = {}
  for (const id of queryPlan.metrics) {
    const metric = queryPlan.decl.metrics[id]
    values[id] = metric?.derived ? deriveMetric(metric.derived, base) : base[id] ?? null
  }
  return values
}

function aggregateMetric(id: string, metric: MetricDef, rows: readonly PreparedRow[]): number | null {
  const aggregate = metric.aggregate ?? "sum"
  if (aggregate === "count") return rows.length
  const column = metricColumn(id, metric)
  const scoped = aggregate === "last" ? rowsAtLatestTime(rows) : rows
  const numbers = scoped.map((row) => parseNumeric(row.source[column])).filter((value): value is number => value !== null)
  if (numbers.length === 0) return null
  switch (aggregate) {
    case "sum":
    case "last":
      return numbers.reduce((total, value) => total + value, 0)
    case "avg":
      return numbers.reduce((total, value) => total + value, 0) / numbers.length
    case "min":
      return Math.min(...numbers)
    case "max":
      return Math.max(...numbers)
  }
}

function rowsAtLatestTime(rows: readonly PreparedRow[]): PreparedRow[] {
  const latest = latestTime(rows)
  if (!latest) return [...rows]
  const target = dayIndex(latest)
  return rows.filter((row) => row.time !== null && dayIndex(row.time) === target)
}

function deriveMetric(derived: NonNullable<MetricDef["derived"]>, base: MetricValues): number | null {
  const operands = derived.of.map((ref) => base[ref] ?? null)
  if (operands.some((value) => value === null)) return null
  const numbers = operands.filter((value): value is number => value !== null)
  switch (derived.op) {
    case "ratio": {
      const [numerator = 0, denominator = 0] = numbers
      return denominator === 0 ? null : numerator / denominator
    }
    case "sum":
      return numbers.reduce((total, value) => total + value, 0)
    case "difference":
      return numbers.slice(1).reduce((total, value) => total - value, numbers[0] ?? 0)
  }
}

function mergeGroups(queryPlan: QueryPlan, groups: Map<string, Group>, compareGroups: Map<string, Group> | null): QueryRow[] {
  const keys = new Set([...groups.keys(), ...(compareGroups?.keys() ?? [])])
  const rows: QueryRow[] = []
  for (const key of keys) {
    const group = groups.get(key)
    const compareGroup = compareGroups?.get(key)
    const dimensions = group?.dimensions ?? compareGroup?.dimensions ?? {}
    const values = group ? aggregateMetrics(queryPlan, group.rows) : emptyValues(queryPlan)
    rows.push({
      key,
      dimensions,
      values,
      ...(compareGroups ? { compare: compareGroup ? aggregateMetrics(queryPlan, compareGroup.rows) : emptyValues(queryPlan) } : {}),
    })
  }
  return rows
}

function emptyValues(queryPlan: QueryPlan): MetricValues {
  return Object.fromEntries(queryPlan.metrics.map((id) => [id, null]))
}

function sortRows(queryPlan: QueryPlan, rows: QueryRow[], sort: DatasetQuery["sort"]): QueryRow[] {
  const dimensions = queryPlan.decl.dimensions ?? {}
  const by = sort?.by ?? defaultSortField(queryPlan)
  if (!by) return rows
  const metricSort = Boolean(queryPlan.decl.metrics[by])
  const direction = sort?.direction ?? (metricSort ? "desc" : "asc")
  const factor = direction === "asc" ? 1 : -1
  const order = dimensions[by]?.order
  return [...rows].sort((left, right) => {
    if (metricSort) return compareNullableNumbers(left.values[by] ?? null, right.values[by] ?? null, factor)
    return factor * compareDimensionValues(left.dimensions[by] ?? "", right.dimensions[by] ?? "", order)
  })
}

function defaultSortField(queryPlan: QueryPlan): string | undefined {
  const dimensions: Record<string, DimensionDef> = queryPlan.decl.dimensions ?? {}
  const time = queryPlan.groupBy.find((id) => dimensions[id]?.kind === "time")
  if (time) return time
  const ordered = queryPlan.groupBy.find((id) => dimensions[id]?.order)
  return ordered ?? queryPlan.metrics[0]
}

function compareNullableNumbers(left: number | null, right: number | null, factor: number): number {
  if (left === right) return 0
  if (left === null) return 1
  if (right === null) return -1
  return factor * (left - right)
}

function compareDimensionValues(left: string, right: string, order: readonly string[] | undefined): number {
  if (order) {
    const leftIndex = order.indexOf(left)
    const rightIndex = order.indexOf(right)
    if (leftIndex !== rightIndex) {
      if (leftIndex === -1) return 1
      if (rightIndex === -1) return -1
      return leftIndex - rightIndex
    }
  }
  return left.localeCompare(right, "en", { numeric: true })
}
