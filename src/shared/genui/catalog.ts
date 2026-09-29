import { z } from "zod"
import type { JsonObject } from "../json"
import { isJsonObject } from "../json"
import { GENUI_IDENTIFIER } from "./datasets"
import { COMPARE_MODES, datasetFilterSchema, periodSpecSchema, SCENARIOS } from "./query"
import { jsonObjectSchema, jsonValueSchema } from "./json-schema"

const identifier = z.string().regex(GENUI_IDENTIFIER)
const shortText = z.string().min(1).max(200)
const longText = z.string().min(1).max(2000)
const statePointer = z.string().regex(/^\/[A-Za-z0-9_\-/]*$/, "is a JSON pointer such as /period")
const workspacePath = z.string().min(1).max(512)

export function isHttpsUrl(value: string): boolean {
  if (!URL.canParse(value)) return false
  return new URL(value).protocol === "https:"
}

export interface DatasetReference {
  dataset: string
  metrics: readonly string[]
  dimensions: readonly string[]
}

export interface GenUIComponentDef {
  props: z.ZodType<JsonObject>
  description: string
  signature: string
  children: boolean
  events: readonly string[]
  datasetRefs?: (props: JsonObject) => DatasetReference[]
}

function stringsAt(props: JsonObject, key: string): string[] {
  const value = props[key]
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")
  return []
}

function filterDimensions(props: JsonObject): string[] {
  const filters = props.filters
  if (!Array.isArray(filters)) return []
  return filters.flatMap((filter) => (isJsonObject(filter) && typeof filter.dimension === "string" ? [filter.dimension] : []))
}

function refsFor(metricKeys: readonly string[], dimensionKeys: readonly string[]) {
  return (props: JsonObject): DatasetReference[] => {
    const dataset = props.dataset
    if (typeof dataset !== "string") return []
    return [{
      dataset,
      metrics: metricKeys.flatMap((key) => stringsAt(props, key)),
      dimensions: [...dimensionKeys.flatMap((key) => stringsAt(props, key)), ...filterDimensions(props), ...drilldownDimension(props)],
    }]
  }
}

function drilldownDimension(props: JsonObject): string[] {
  const drilldown = props.drilldown
  return isJsonObject(drilldown) && typeof drilldown.dimension === "string" ? [drilldown.dimension] : []
}

const tone = z.enum(["neutral", "positive", "negative", "attention", "info"])
const compareWith = z.enum([...COMPARE_MODES, "none"])
const filters = z.array(datasetFilterSchema).max(12)
const chartKinds = ["line", "bar", "area", "stacked-bar", "waterfall", "combo", "composition"] as const
const statementTotals = z.array(z.strictObject({ label: shortText, groups: z.array(z.string().min(1).max(120)).min(1).max(20) })).max(10)

const financialTableProps = {
  dataset: identifier,
  metric: identifier.optional(),
  metrics: z.array(identifier).min(1).max(8).optional(),
  rows: identifier.optional(),
  groupRows: identifier.optional(),
  columns: z.enum(["period", "metrics"]).optional(),
  period: periodSpecSchema.optional(),
  compareWith: compareWith.optional(),
  filters: filters.optional(),
  totals: statementTotals.optional(),
  title: shortText.optional(),
  limit: z.number().int().min(1).max(500).optional(),
}

const statementProps = z.strictObject({
  dataset: identifier,
  metric: identifier,
  rows: identifier,
  groupRows: identifier.optional(),
  period: periodSpecSchema.optional(),
  compareWith: compareWith.optional(),
  filters: filters.optional(),
  totals: statementTotals.optional(),
  title: shortText.optional(),
})

const STATEMENT_SIGNATURE = "dataset, metric, rows, groupRows?, period?, compareWith?, filters?, totals?: [{label, groups[]}], title?"

export const GENUI_COMPONENTS = {
  Stack: {
    props: z.strictObject({ direction: z.enum(["vertical", "horizontal"]).optional(), gap: z.enum(["sm", "md", "lg"]).optional() }),
    description: "Lays children out in a column (default) or a wrapping row.",
    signature: "direction?: vertical|horizontal, gap?: sm|md|lg",
    children: true,
    events: [],
  },
  Grid: {
    props: z.strictObject({ columns: z.number().int().min(1).max(4).optional(), gap: z.enum(["sm", "md", "lg"]).optional() }),
    description: "Responsive grid; columns is the maximum on a wide screen and collapses to one on a phone.",
    signature: "columns?: 1-4, gap?: sm|md|lg",
    children: true,
    events: [],
  },
  Card: {
    props: z.strictObject({ title: shortText.optional(), description: longText.optional() }),
    description: "A bordered surface that groups related children under an optional title.",
    signature: "title?, description?",
    children: true,
    events: [],
  },
  Section: {
    props: z.strictObject({ title: shortText, description: longText.optional() }),
    description: "A titled region without a border.",
    signature: "title, description?",
    children: true,
    events: [],
  },
  Tabs: {
    props: z.strictObject({
      items: z.array(z.strictObject({ value: z.string().min(1).max(60), label: z.string().min(1).max(60) })).min(1).max(8),
      value: z.string().max(60).optional(),
    }),
    description: "A tab bar. Child N is the panel for items[N]; bind value with $bindState to remember the selection.",
    signature: "items: [{value, label}], value?",
    children: true,
    events: [],
  },
  Text: {
    props: z.strictObject({ text: z.string().max(4000), variant: z.enum(["body", "muted", "heading", "label"]).optional() }),
    description: "A paragraph, heading, or label of plain text (no markdown).",
    signature: "text, variant?: body|muted|heading|label",
    children: false,
    events: [],
  },
  Badge: {
    props: z.strictObject({ label: z.string().min(1).max(60), tone: tone.optional() }),
    description: "A short status label. Tone is always paired with the label text.",
    signature: "label, tone?: neutral|positive|negative|attention|info",
    children: false,
    events: [],
  },
  Button: {
    props: z.strictObject({ label: z.string().min(1).max(60), variant: z.enum(["primary", "secondary", "ghost"]).optional() }),
    description: "Fires its on.press action binding.",
    signature: "label, variant?: primary|secondary|ghost; on: {press: action}",
    children: false,
    events: ["press"],
  },
  Divider: {
    props: z.strictObject({}),
    description: "A 1px separator.",
    signature: "(no props)",
    children: false,
    events: [],
  },
  KeyValue: {
    props: z.strictObject({
      items: z.array(z.strictObject({ label: z.string().min(1).max(80), value: z.union([z.string().max(400), z.number(), z.boolean(), z.null()]) })).min(1).max(40),
      columns: z.number().int().min(1).max(2).optional(),
    }),
    description: "Label/value pairs such as build facts or configuration.",
    signature: "items: [{label, value}], columns?: 1|2",
    children: false,
    events: [],
  },
  DataTable: {
    props: z.strictObject({
      dataset: identifier.optional(),
      metrics: z.array(identifier).min(1).max(8).optional(),
      dimensions: z.array(identifier).max(3).optional(),
      period: periodSpecSchema.optional(),
      compareWith: compareWith.optional(),
      filters: filters.optional(),
      limit: z.number().int().min(1).max(500).optional(),
      columns: z.array(z.strictObject({ key: z.string().min(1).max(64), label: z.string().min(1).max(80) })).min(1).max(12).optional(),
      rows: z.array(jsonObjectSchema).max(100).optional(),
      title: shortText.optional(),
    }),
    description: "A table. Either dataset-bound (dataset + metrics, grouped by dimensions) or a small static table (columns + rows, at most 100).",
    signature: "dataset?, metrics?, dimensions?, period?, compareWith?, filters?, limit?, columns?: [{key, label}], rows?, title?",
    children: false,
    events: [],
    datasetRefs: refsFor(["metrics"], ["dimensions"]),
  },
  FileList: {
    props: z.strictObject({
      files: z.array(z.strictObject({
        path: workspacePath,
        description: z.string().max(200).optional(),
        status: z.enum(["added", "modified", "deleted", "renamed"]).optional(),
      })).min(1).max(100),
    }),
    description: "Files with an optional change status; each row opens the file.",
    signature: "files: [{path, description?, status?: added|modified|deleted|renamed}]",
    children: false,
    events: [],
  },
  DiagnosticList: {
    props: z.strictObject({
      items: z.array(z.strictObject({
        severity: z.enum(["error", "warning", "info"]),
        message: z.string().min(1).max(1000),
        path: workspacePath.optional(),
        line: z.number().int().min(1).optional(),
        column: z.number().int().min(1).optional(),
        source: z.string().max(60).optional(),
      })).min(1).max(200),
    }),
    description: "Compiler, linter, or type-checker findings; rows with a path open the file at the line.",
    signature: "items: [{severity: error|warning|info, message, path?, line?, column?, source?}]",
    children: false,
    events: [],
  },
  TestResult: {
    props: z.strictObject({
      passed: z.number().int().min(0),
      failed: z.number().int().min(0),
      skipped: z.number().int().min(0).optional(),
      durationMs: z.number().min(0).optional(),
      command: z.string().max(300).optional(),
      failures: z.array(z.strictObject({
        name: z.string().min(1).max(300),
        message: z.string().max(2000).optional(),
        path: workspacePath.optional(),
        line: z.number().int().min(1).optional(),
      })).max(50).optional(),
    }),
    description: "A test run summary. Each failure offers to open the file and to ask the agent to fix it.",
    signature: "passed, failed, skipped?, durationMs?, command?, failures?: [{name, message?, path?, line?}]",
    children: false,
    events: [],
  },
  Timeline: {
    props: z.strictObject({
      items: z.array(z.strictObject({
        time: z.string().max(60).optional(),
        title: z.string().min(1).max(200),
        detail: z.string().max(1000).optional(),
        tone: tone.optional(),
      })).min(1).max(50),
    }),
    description: "An ordered sequence of events.",
    signature: "items: [{time?, title, detail?, tone?}]",
    children: false,
    events: [],
  },
  FinancialMetric: {
    props: z.strictObject({
      dataset: identifier,
      metric: identifier,
      label: shortText.optional(),
      period: periodSpecSchema.optional(),
      compareWith: compareWith.optional(),
      scenario: z.enum(SCENARIOS).optional(),
      filters: filters.optional(),
    }),
    description: "One headline number with its variance against compareWith.",
    signature: "dataset, metric, label?, period?, compareWith?, scenario?, filters?",
    children: false,
    events: [],
    datasetRefs: refsFor(["metric"], []),
  },
  FinancialChart: {
    props: z.strictObject({
      chart: z.enum(chartKinds),
      dataset: identifier,
      metric: z.union([identifier, z.array(identifier).min(1).max(4)]),
      dimension: identifier,
      series: identifier.optional(),
      secondaryMetric: identifier.optional(),
      period: periodSpecSchema.optional(),
      compareWith: compareWith.optional(),
      filters: filters.optional(),
      title: shortText.optional(),
      totalLabel: z.string().min(1).max(60).optional(),
      drilldown: z.strictObject({ dimension: identifier }).optional(),
      explain: z.boolean().optional(),
      height: z.enum(["sm", "md", "lg"]).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    description: "A chart over a dataset. line/area/bar for trends and comparisons, stacked-bar with series for composition, waterfall for a bridge (steps along dimension, closed by totalLabel), combo for a bar metric plus a secondaryMetric line, composition for a small part-to-whole. drilldown makes points clickable; explain adds an \"Explain variance\" action.",
    signature: "chart: line|bar|area|stacked-bar|waterfall|combo|composition, dataset, metric (or up to 4), dimension, series?, secondaryMetric?, period?, compareWith?, filters?, title?, totalLabel?, drilldown?: {dimension}, explain?, height?: sm|md|lg, limit?",
    children: false,
    events: [],
    datasetRefs: refsFor(["metric", "secondaryMetric"], ["dimension", "series"]),
  },
  FinancialTable: {
    props: z.strictObject({ variant: z.enum(["detail", "statement", "comparison"]).optional(), ...financialTableProps }),
    description: "A financial table. detail: metrics by the rows dimension. comparison: metric with variance columns. statement: line items (rows) under groups (groupRows) with subtotals and totals.",
    signature: "variant?: detail|statement|comparison, dataset, metric?, metrics?, rows?, groupRows?, columns?: period|metrics, period?, compareWith?, filters?, totals?, title?, limit?",
    children: false,
    events: [],
    datasetRefs: refsFor(["metric", "metrics"], ["rows", "groupRows"]),
  },
  IncomeStatement: {
    props: statementProps,
    description: "A profit and loss statement: a FinancialTable statement with income-statement defaults.",
    signature: STATEMENT_SIGNATURE,
    children: false,
    events: [],
    datasetRefs: refsFor(["metric"], ["rows", "groupRows"]),
  },
  BalanceSheet: {
    props: statementProps,
    description: "A balance sheet: a FinancialTable statement whose metric should aggregate with \"last\".",
    signature: STATEMENT_SIGNATURE,
    children: false,
    events: [],
    datasetRefs: refsFor(["metric"], ["rows", "groupRows"]),
  },
  CashFlowStatement: {
    props: statementProps,
    description: "A cash flow statement: a FinancialTable statement with cash-flow defaults.",
    signature: STATEMENT_SIGNATURE,
    children: false,
    events: [],
    datasetRefs: refsFor(["metric"], ["rows", "groupRows"]),
  },
  PeriodSelector: {
    props: z.strictObject({ value: z.string().max(40).optional(), options: z.array(z.string().min(1).max(40)).min(1).max(12).optional(), label: shortText.optional() }),
    description: "Picks a period. Bind value with $bindState and read it from charts with $state.",
    signature: "value (bind), options?: period strings, label?",
    children: false,
    events: [],
  },
  CompareSelector: {
    props: z.strictObject({ value: z.string().max(40).optional(), options: z.array(compareWith).min(1).max(5).optional(), label: shortText.optional() }),
    description: "Picks the comparison baseline. Bind value with $bindState.",
    signature: "value (bind), options?: previous-period|previous-year|budget|forecast|none, label?",
    children: false,
    events: [],
  },
  CurrencySelector: {
    props: z.strictObject({ value: z.string().max(40).optional(), dataset: identifier, dimension: identifier, label: shortText.optional() }),
    description: "Filters a dataset to one reporting currency, offering the values of its currency dimension. Bind value with $bindState and use it in a filter.",
    signature: "value (bind), dataset, dimension, label?",
    children: false,
    events: [],
    datasetRefs: refsFor([], ["dimension"]),
  },
  EntitySelector: {
    props: z.strictObject({ value: z.string().max(200).optional(), dataset: identifier, dimension: identifier, label: shortText.optional(), includeAll: z.boolean().optional() }),
    description: "Picks one value of a dimension (entity, department, region). Bind value with $bindState and use it in a filter; \"all\" means no filter.",
    signature: "value (bind), dataset, dimension, label?, includeAll?",
    children: false,
    events: [],
    datasetRefs: refsFor([], ["dimension"]),
  },
} satisfies Record<string, GenUIComponentDef>

export type GenUIComponentName = keyof typeof GENUI_COMPONENTS

export type ActionClass = "local" | "kanna" | "agent"

export interface GenUIActionDef {
  class: ActionClass
  params: z.ZodType<JsonObject>
  description: string
  signature: string
  builtIn?: boolean
}

const explainVarianceParams = z.strictObject({
  dataset: identifier,
  metric: identifier,
  period: periodSpecSchema.optional(),
  compareWith: z.enum(COMPARE_MODES).optional(),
  filters: filters.optional(),
  question: z.string().max(500).optional(),
})

export const GENUI_ACTIONS = {
  setState: {
    class: "local",
    params: z.strictObject({ statePath: statePointer, value: jsonValueSchema }),
    description: "Write a value into the view's local state.",
    signature: "{statePath, value}",
    builtIn: true,
  },
  pushState: {
    class: "local",
    params: z.strictObject({ statePath: statePointer, value: jsonValueSchema, clearStatePath: statePointer.optional() }),
    description: "Append a value to a list in local state.",
    signature: "{statePath, value, clearStatePath?}",
    builtIn: true,
  },
  removeState: {
    class: "local",
    params: z.strictObject({ statePath: statePointer, index: z.number().int().min(0) }),
    description: "Remove an item from a list in local state.",
    signature: "{statePath, index}",
    builtIn: true,
  },
  "file.open": {
    class: "kanna",
    params: z.strictObject({ path: workspacePath, line: z.number().int().min(1).optional() }),
    description: "Open a workspace file in Kanna's preview.",
    signature: "{path, line?}",
  },
  "link.open": {
    class: "kanna",
    params: z.strictObject({ url: z.string().max(2000).refine(isHttpsUrl, "must be an absolute https URL") }),
    description: "Open an https link in a new tab after the user clicks.",
    signature: "{url}",
  },
  "dataset.refresh": {
    class: "kanna",
    params: z.strictObject({ dataset: identifier }),
    description: "Re-read a dataset from its source.",
    signature: "{dataset}",
  },
  "financial.drilldown": {
    class: "kanna",
    params: z.strictObject({
      dataset: identifier,
      metric: identifier,
      dimension: identifier,
      value: z.string().max(200),
      into: identifier,
      period: periodSpecSchema.optional(),
    }),
    description: "Break one value of a dimension down by another dimension, without the agent. Charts with drilldown emit it on click.",
    signature: "{dataset, metric, dimension, value, into, period?}",
  },
  "agent.ask": {
    class: "agent",
    params: z.strictObject({ prompt: longText, context: jsonObjectSchema.optional() }),
    description: "Send a question to the agent, with structured context, after the user confirms.",
    signature: "{prompt, context?}",
  },
  "agent.investigate": {
    class: "agent",
    params: z.strictObject({ subject: shortText, context: jsonObjectSchema.optional() }),
    description: "Ask the agent to investigate something shown in the view.",
    signature: "{subject, context?}",
  },
  "agent.fix": {
    class: "agent",
    params: z.strictObject({ subject: shortText, context: jsonObjectSchema.optional() }),
    description: "Ask the agent to fix a problem shown in the view (a failing test, a diagnostic).",
    signature: "{subject, context?}",
  },
  "financial.explainVariance": {
    class: "agent",
    params: explainVarianceParams,
    description: "Ask the agent to explain a metric's variance; Kanna attaches the computed values and the dataset source.",
    signature: "{dataset, metric, period?, compareWith?, filters?, question?}",
  },
} satisfies Record<string, GenUIActionDef>

export type GenUIActionName = keyof typeof GENUI_ACTIONS

export function isGenUIComponentName(name: string): name is GenUIComponentName {
  return Object.hasOwn(GENUI_COMPONENTS, name)
}

export function isGenUIActionName(name: string): name is GenUIActionName {
  return Object.hasOwn(GENUI_ACTIONS, name)
}

export function componentDef(name: GenUIComponentName): GenUIComponentDef {
  return GENUI_COMPONENTS[name]
}

export function actionDef(name: GenUIActionName): GenUIActionDef {
  return GENUI_ACTIONS[name]
}
