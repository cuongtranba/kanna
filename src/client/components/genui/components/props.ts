import type { ComponentRenderProps } from "@json-render/react"
import { jsonObjectSchema, type CompareMode, type DatasetFilter, type DatasetQuery, type PeriodSpec } from "../../../../shared/genui"
import { isJsonArray, isJsonObject, type JsonObject, type JsonValue } from "../../../../shared/json"
import { ELEMENT_KEY_PROP } from "../useElementUiState"

export const ALL_VALUES = "all"

function isUsableFilter(value: JsonValue): boolean {
  if (!isJsonObject(value)) return false
  const target = value.value
  if (target === ALL_VALUES || target === "" || target === null || target === undefined) return false
  if (isJsonArray(target)) return target.length > 0
  return typeof target === "string" || typeof target === "number"
}

export function resolvedProps(props: ComponentRenderProps["element"]["props"]): JsonObject | null {
  const parsed = jsonObjectSchema.safeParse(stripUndefined(props))
  if (!parsed.success) return null
  const filters = parsed.data.filters
  if (!isJsonArray(filters)) return parsed.data
  return { ...parsed.data, filters: filters.filter(isUsableFilter) }
}

function stripUndefined(props: ComponentRenderProps["element"]["props"]): ComponentRenderProps["element"]["props"] {
  return Object.fromEntries(Object.entries(props).filter(([key, value]) => key !== ELEMENT_KEY_PROP && value !== undefined && value !== null))
}

export function compareOf(value: CompareMode | "none" | undefined): CompareMode | undefined {
  return value === "none" ? undefined : value
}

export function withDrillFilter(filters: readonly DatasetFilter[] | undefined, drill: { dimension: string; value: string } | null): DatasetFilter[] | undefined {
  const all = drill ? [...(filters ?? []), { dimension: drill.dimension, value: drill.value }] : filters
  return all && all.length > 0 ? [...all] : undefined
}

export function metricListOf(props: { metric?: string | readonly string[] | undefined; metrics?: readonly string[] | undefined }): string[] {
  if (props.metrics) return [...props.metrics]
  if (props.metric === undefined) return []
  return typeof props.metric === "string" ? [props.metric] : [...props.metric]
}

export function primaryMetricOf(props: { metric?: string | readonly string[] | undefined; metrics?: readonly string[] | undefined }): string {
  return metricListOf(props)[0] ?? ""
}

interface DatasetQueryParts {
  metrics: string[]
  groupBy?: string[] | undefined
  period?: DatasetQuery["period"] | undefined
  compare?: DatasetQuery["compare"] | undefined
  scenario?: DatasetQuery["scenario"] | undefined
  filters?: DatasetFilter[] | undefined
  sort?: DatasetQuery["sort"] | undefined
  limit?: number | undefined
}

export function datasetQuery({ metrics, groupBy, period, compare, scenario, filters, sort, limit }: DatasetQueryParts): DatasetQuery {
  return {
    metrics,
    ...(groupBy ? { groupBy } : {}),
    ...(period ? { period } : {}),
    ...(compare ? { compare } : {}),
    ...(scenario ? { scenario } : {}),
    ...(filters && filters.length > 0 ? { filters } : {}),
    ...(sort ? { sort } : {}),
    ...(limit !== undefined ? { limit } : {}),
  }
}

export function periodKey(period: PeriodSpec | undefined): string {
  if (period === undefined) return "all"
  return typeof period === "string" ? period : `${period.from}..${period.to}`
}
