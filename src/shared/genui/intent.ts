import { z } from "zod"
import { safeJsonParse, type JsonObject } from "../json"
import { describeDatasetSource, metricLabel, type DatasetDecl } from "./datasets"
import { extractKannaUiIntentFences, fenceBlock, KANNA_UI_INTENT_FENCE_LANGUAGE } from "./fences"
import { computeVariance, formatMetricValue, valueFormatOf } from "./format"
import { jsonObjectSchema } from "./json-schema"
import type { DatasetFilter, QueryResult } from "./query"
import { describeCompareMode, describePeriodSpec, type CompareMode, type PeriodSpec } from "./period"

export const AGENT_INTENT_ACTIONS = ["agent.ask", "agent.investigate", "agent.fix", "financial.explainVariance"] as const
export type AgentIntentAction = (typeof AGENT_INTENT_ACTIONS)[number]

export interface AgentIntent {
  action: AgentIntentAction
  headline: string
  context: JsonObject
}

const intentPayloadSchema = z.strictObject({
  action: z.enum(AGENT_INTENT_ACTIONS),
  context: jsonObjectSchema,
})

const HEADLINE_LIMIT = 300

function clampHeadline(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim()
  return oneLine.length > HEADLINE_LIMIT ? `${oneLine.slice(0, HEADLINE_LIMIT - 1)}…` : oneLine
}

export function formatIntentMessage(intent: AgentIntent): string {
  const payload = JSON.stringify({ action: intent.action, context: intent.context }, null, 2)
  return `${clampHeadline(intent.headline)}\n\n${fenceBlock(KANNA_UI_INTENT_FENCE_LANGUAGE, payload)}`
}

export interface ParsedIntentMessage {
  headline: string
  action: AgentIntentAction
  context: JsonObject
}

export function parseIntentMessage(content: string): ParsedIntentMessage | null {
  const fence = extractKannaUiIntentFences(content).find((candidate) => candidate.closed)
  if (!fence) return null
  const parsed = intentPayloadSchema.safeParse(safeJsonParse(fence.source))
  if (!parsed.success) return null
  const headline = content.split("\n").find((line) => line.trim().length > 0)?.trim() ?? ""
  return { headline, action: parsed.data.action, context: parsed.data.context }
}

const FREEFORM_PREFIX: Readonly<Record<"agent.ask" | "agent.investigate" | "agent.fix", string>> = {
  "agent.ask": "",
  "agent.investigate": "Investigate",
  "agent.fix": "Fix",
}

export interface ViewContext {
  title?: string
}

export function buildFreeformIntent(
  action: "agent.ask" | "agent.investigate" | "agent.fix",
  text: string,
  context: JsonObject | undefined,
  view: ViewContext,
): AgentIntent {
  const headline = FREEFORM_PREFIX[action] ? `${FREEFORM_PREFIX[action]}: ${text}` : text
  return {
    action,
    headline,
    context: {
      ...(view.title ? { view: view.title } : {}),
      ...(action === "agent.ask" ? { question: text } : { subject: text }),
      ...(context ?? {}),
    },
  }
}

export interface ExplainVarianceInput {
  datasetId: string
  decl: DatasetDecl
  metric: string
  period?: PeriodSpec
  compareWith: CompareMode
  filters?: readonly DatasetFilter[]
  question?: string
  result: QueryResult | null
}

export function buildExplainVarianceIntent(input: ExplainVarianceInput, view: ViewContext): AgentIntent {
  const metricDef = input.decl.metrics[input.metric]
  const label = metricLabel(input.metric, metricDef)
  const format = valueFormatOf(metricDef)
  const value = input.result?.totals.values[input.metric] ?? null
  const compare = input.result?.totals.compare?.[input.metric] ?? null
  const variance = computeVariance(value, compare, format, metricDef?.direction)
  const comparisonLabel = input.result?.comparison?.label ?? describeCompareMode(input.compareWith)
  const periodLabel = input.result?.period.label ?? describePeriodSpec(input.period)
  const headline = input.question
    ? input.question
    : `Explain the ${label.toLowerCase()} variance for ${periodLabel} against ${comparisonLabel.toLowerCase()}`
  return {
    action: "financial.explainVariance",
    headline,
    context: {
      ...(view.title ? { view: view.title } : {}),
      metric: { id: input.metric, label, format: format.format, ...(format.currency ? { currency: format.currency } : {}) },
      period: periodLabel,
      comparison: comparisonLabel,
      ...(input.filters && input.filters.length > 0 ? { filters: input.filters.map((filter) => ({ ...filter })) } : {}),
      values: {
        current: value,
        baseline: compare,
        change: variance.amount,
        changeRatio: variance.ratio,
        currentText: formatMetricValue(value, format),
        baselineText: formatMetricValue(compare, format),
        changeText: variance.amountText,
        changeRatioText: variance.ratioText,
      },
      dataset: { id: input.datasetId, ...describeDatasetSource(input.decl), metrics: Object.keys(input.decl.metrics), dimensions: Object.keys(input.decl.dimensions ?? {}) },
    },
  }
}
