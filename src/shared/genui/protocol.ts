import { z } from "zod"
import type { JsonValue } from "../json"
import { TIME_GRAINS } from "./datasets"
import { COMPARE_MODES, type QueryResult } from "./query"

export const DATASET_ERROR_CODES = [
  "invalid_dataset",
  "invalid_query",
  "not_found",
  "unauthorized",
  "too_large",
  "parse_failed",
  "source_unavailable",
] as const

export type DatasetErrorCode = (typeof DATASET_ERROR_CODES)[number]

export type DatasetQueryOutcome =
  | { status: "ok"; result: QueryResult; revision: string; fetchedAt: number }
  | { status: "needs_approval"; server: string; tool: string; message: string }
  | { status: "error"; code: DatasetErrorCode; message: string }

const metricValues = z.record(z.string(), z.number().nullable())

const queryResultSchema = z.object({
  rows: z.array(z.object({
    key: z.string(),
    dimensions: z.record(z.string(), z.string()),
    values: metricValues,
    compare: metricValues.optional(),
  })),
  totals: z.object({ values: metricValues, compare: metricValues.optional() }),
  period: z.object({
    label: z.string(),
    window: z.object({ unit: z.enum(["month", "day"]), from: z.number(), to: z.number() }).nullable(),
  }),
  comparison: z.object({ mode: z.enum(COMPARE_MODES), label: z.string() }).optional(),
  timeDimension: z.string().nullable(),
  grain: z.enum(TIME_GRAINS).nullable(),
  truncated: z.boolean(),
  sourceRowCount: z.number(),
})

const outcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), result: queryResultSchema, revision: z.string(), fetchedAt: z.number() }),
  z.object({ status: z.literal("needs_approval"), server: z.string(), tool: z.string(), message: z.string() }),
  z.object({ status: z.literal("error"), code: z.enum(DATASET_ERROR_CODES), message: z.string() }),
])

export function decodeDatasetQueryOutcome(value: JsonValue): DatasetQueryOutcome | null {
  const parsed = outcomeSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export const DATASET_ERROR_MESSAGES: Readonly<Record<DatasetErrorCode, string>> = {
  invalid_dataset: "This report describes its data incorrectly",
  invalid_query: "This view asks for data the dataset does not have",
  not_found: "The data source could not be found",
  unauthorized: "This data source is not allowed",
  too_large: "The data source is too large to load",
  parse_failed: "The data could not be read",
  source_unavailable: "Unable to load this report's data",
}
