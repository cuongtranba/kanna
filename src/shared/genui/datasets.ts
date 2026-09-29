import { z } from "zod"
import { isJsonObject, type JsonObject, type JsonValue } from "../json"
import { jsonByteLength, jsonObjectSchema } from "./json-schema"

export const GENUI_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/
export const INLINE_DATASET_MAX_ROWS = 500
export const INLINE_DATASET_MAX_BYTES = 64 * 1024
export const MCP_ARGUMENTS_MAX_BYTES = 16 * 1024

const identifier = z.string().regex(GENUI_IDENTIFIER, "must start with a letter and use only letters, digits, _ . -")
const columnName = z.string().min(1).max(128)
const label = z.string().min(1).max(80)
const rowsPath = z.string().regex(/^[A-Za-z0-9_$-]+(\.[A-Za-z0-9_$-]+)*$/, "is a dotted path such as rows or data.items")

export const METRIC_FORMATS = ["currency", "percent", "number"] as const
export const METRIC_AGGREGATES = ["sum", "avg", "min", "max", "last", "count"] as const
export const DERIVED_OPS = ["ratio", "sum", "difference"] as const
export const TIME_GRAINS = ["day", "month", "quarter", "year"] as const

export type MetricFormat = (typeof METRIC_FORMATS)[number]
export type MetricAggregate = (typeof METRIC_AGGREGATES)[number]
export type TimeGrain = (typeof TIME_GRAINS)[number]

const metricDefSchema = z.strictObject({
  column: columnName.optional(),
  label: label.optional(),
  format: z.enum(METRIC_FORMATS).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/, "is an ISO 4217 code such as USD").optional(),
  aggregate: z.enum(METRIC_AGGREGATES).optional(),
  derived: z.strictObject({ op: z.enum(DERIVED_OPS), of: z.array(identifier).min(2).max(8) }).optional(),
  direction: z.enum(["higher-is-better", "lower-is-better"]).optional(),
  decimals: z.number().int().min(0).max(6).optional(),
})

const dimensionDefSchema = z.strictObject({
  column: columnName.optional(),
  label: label.optional(),
  kind: z.enum(["time", "category"]).optional(),
  grain: z.enum(TIME_GRAINS).optional(),
  order: z.array(z.string().max(120)).max(200).optional(),
  parent: identifier.optional(),
})

const scenarioSchema = z.strictObject({
  column: columnName,
  actual: z.string().min(1).max(80),
  budget: z.string().min(1).max(80).optional(),
  forecast: z.string().min(1).max(80).optional(),
})

const commonShape = {
  label: label.optional(),
  metrics: z.record(identifier, metricDefSchema),
  dimensions: z.record(identifier, dimensionDefSchema).optional(),
  scenario: scenarioSchema.optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  refreshSeconds: z.number().int().min(5).max(3600).optional(),
}

const relativeFilePath = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => isRelativeWorkspacePath(value), "is a path relative to the chat's working directory, without ..")

const datasetDeclShape = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("inline"), rows: z.array(jsonObjectSchema).max(INLINE_DATASET_MAX_ROWS), ...commonShape }),
  z.strictObject({
    source: z.literal("file"),
    path: relativeFilePath,
    format: z.enum(["csv", "json"]).optional(),
    rowsPath: rowsPath.optional(),
    ...commonShape,
  }),
  z.strictObject({
    source: z.literal("mcp"),
    server: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/, "is the name of a configured MCP server"),
    tool: z.string().min(1).max(128),
    arguments: jsonObjectSchema.optional(),
    rowsPath: rowsPath.optional(),
    ...commonShape,
  }),
])

export type DatasetDecl = z.output<typeof datasetDeclShape>
export type MetricDef = z.output<typeof metricDefSchema>
export type DimensionDef = z.output<typeof dimensionDefSchema>

export const datasetDeclSchema = datasetDeclShape.superRefine((decl, ctx) => {
  const metricIds = Object.keys(decl.metrics)
  if (metricIds.length === 0) ctx.addIssue({ code: "custom", path: ["metrics"], message: "declare at least one metric" })
  if (metricIds.length > 32) ctx.addIssue({ code: "custom", path: ["metrics"], message: "declare at most 32 metrics" })
  for (const [id, metric] of Object.entries(decl.metrics)) {
    if (!metric.derived) continue
    if (metric.column || metric.aggregate) {
      ctx.addIssue({ code: "custom", path: ["metrics", id], message: "a derived metric has no column or aggregate of its own" })
    }
    if (metric.derived.op === "ratio" && metric.derived.of.length !== 2) {
      ctx.addIssue({ code: "custom", path: ["metrics", id, "derived", "of"], message: "a ratio names exactly two metrics: numerator, denominator" })
    }
    for (const ref of metric.derived.of) {
      const target = decl.metrics[ref]
      if (!target) ctx.addIssue({ code: "custom", path: ["metrics", id, "derived"], message: `unknown metric "${ref}"` })
      else if (target.derived) ctx.addIssue({ code: "custom", path: ["metrics", id, "derived"], message: `"${ref}" is itself derived; derive only from base metrics` })
    }
  }
  const dimensions = decl.dimensions ?? {}
  if (Object.keys(dimensions).length > 16) ctx.addIssue({ code: "custom", path: ["dimensions"], message: "declare at most 16 dimensions" })
  for (const [id, dimension] of Object.entries(dimensions)) {
    if (dimension.grain && dimension.kind !== "time") {
      ctx.addIssue({ code: "custom", path: ["dimensions", id, "grain"], message: "grain applies only to a time dimension" })
    }
    if (dimension.parent && !dimensions[dimension.parent]) {
      ctx.addIssue({ code: "custom", path: ["dimensions", id, "parent"], message: `unknown dimension "${dimension.parent}"` })
    }
  }
  if (decl.source === "inline" && jsonByteLength(decl.rows) > INLINE_DATASET_MAX_BYTES) {
    ctx.addIssue({ code: "custom", path: ["rows"], message: `inline rows exceed ${INLINE_DATASET_MAX_BYTES / 1024} KB; write them to a file and use source "file"` })
  }
  if (decl.source === "mcp" && decl.arguments && jsonByteLength(decl.arguments) > MCP_ARGUMENTS_MAX_BYTES) {
    ctx.addIssue({ code: "custom", path: ["arguments"], message: `arguments exceed ${MCP_ARGUMENTS_MAX_BYTES / 1024} KB` })
  }
})

export function isRelativeWorkspacePath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/")
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.startsWith("~")) return false
  return normalized.split("/").every((segment) => segment !== ".." && segment !== "")
}

export function metricColumn(id: string, metric: MetricDef): string {
  return metric.column ?? id
}

export function dimensionColumn(id: string, dimension: DimensionDef): string {
  return dimension.column ?? id
}

export function metricLabel(id: string, metric: MetricDef | undefined): string {
  return metric?.label ?? humanizeIdentifier(id)
}

export function dimensionLabel(id: string, dimension: DimensionDef | undefined): string {
  return dimension?.label ?? humanizeIdentifier(id)
}

export function timeDimensionOf(decl: DatasetDecl, preferred?: string): string | null {
  const dimensions = decl.dimensions ?? {}
  if (preferred && dimensions[preferred]?.kind === "time") return preferred
  const found = Object.entries(dimensions).find(([, dimension]) => dimension.kind === "time")
  return found ? found[0] : null
}

export function humanizeIdentifier(id: string): string {
  const words = id.replace(/[_.-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function describeDatasetSource(decl: DatasetDecl): JsonObject {
  switch (decl.source) {
    case "inline":
      return { source: "inline", rowCount: decl.rows.length }
    case "file":
      return { source: "file", path: decl.path, ...(decl.format ? { format: decl.format } : {}) }
    case "mcp":
      return { source: "mcp", server: decl.server, tool: decl.tool, ...(decl.arguments ? { arguments: decl.arguments } : {}) }
  }
}

function sortedKeys(_key: string, value: JsonValue): JsonValue {
  if (!isJsonObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) => {
    const field = value[key]
    return field === undefined ? [] : [[key, field]]
  }))
}

export function datasetFreezeKey(decl: DatasetDecl): string {
  return JSON.stringify(decl, sortedKeys)
}

export function datasetColumns(decl: DatasetDecl): string[] {
  const columns = new Set<string>()
  for (const [id, metric] of Object.entries(decl.metrics)) {
    if (!metric.derived) columns.add(metricColumn(id, metric))
  }
  for (const [id, dimension] of Object.entries(decl.dimensions ?? {})) columns.add(dimensionColumn(id, dimension))
  if (decl.scenario) columns.add(decl.scenario.column)
  return [...columns]
}

export function projectDatasetRows(decl: DatasetDecl, rows: readonly JsonObject[]): JsonObject[] {
  const columns = datasetColumns(decl)
  return rows.map((row) => Object.fromEntries(columns.flatMap((column) => {
    const value = row[column]
    return value === undefined ? [] : [[column, value]]
  })))
}
