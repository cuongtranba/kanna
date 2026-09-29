import { useMemo } from "react"
import { useBoundProp, type ComponentRenderProps } from "@json-render/react"
import {
  computeVariance,
  COMPARE_MODES,
  describeCompareMode,
  describePeriodSpec,
  dimensionLabel,
  formatMetricValue,
  GENUI_COMPONENTS,
  metricLabel,
  valueFormatOf,
  type DatasetQuery,
} from "../../../../shared/genui"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select"
import { cn } from "../../../lib/utils"
import { useDatasetDecl, useDatasetQuery } from "../useDatasetQuery"
import { useGenUIView } from "../view-context"
import { useDrillState } from "./financial-chart"
import { DataStateNotice, PropsIssue, sentimentTone, toneInkClass, TrendIcon } from "./primitives"
import { FinancialTableBody } from "./financial-table-body"
import { ALL_VALUES, compareOf, resolvedProps, withDrillFilter } from "./props"

function parse<T>(props: ComponentRenderProps["element"]["props"], parser: (json: ReturnType<typeof resolvedProps>) => T | null): T | null {
  return parser(resolvedProps(props))
}

export function FinancialMetricElement({ element }: ComponentRenderProps) {
  const props = useMemo(() => parse(element.props, (json) => {
    const parsed = GENUI_COMPONENTS.FinancialMetric.props.safeParse(json)
    return parsed.success ? parsed.data : null
  }), [element.props])
  const decl = useDatasetDecl(props?.dataset)
  const drill = useDrillState(props?.dataset)
  const query = useMemo((): DatasetQuery | null => {
    if (!props) return null
    const compare = compareOf(props.compareWith)
    const filters = withDrillFilter(props.filters, drill)
    return {
      metrics: [props.metric],
      ...(props.period ? { period: props.period } : {}),
      ...(compare ? { compare } : {}),
      ...(props.scenario ? { scenario: props.scenario } : {}),
      ...(filters && filters.length > 0 ? { filters } : {}),
    }
  }, [drill, props])
  const state = useDatasetQuery(props?.dataset, query)
  if (!props) return <PropsIssue component="FinancialMetric" />

  const metricDef = decl?.metrics[props.metric]
  const label = props.label ?? metricLabel(props.metric, metricDef)
  if (state.status !== "ok") {
    return (
      <div className="flex flex-col gap-1 rounded-md border border-border p-3">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <DataStateNotice state={state} />
      </div>
    )
  }
  const format = valueFormatOf(metricDef)
  const value = state.result.totals.values[props.metric] ?? null
  const compare = state.result.totals.compare?.[props.metric] ?? null
  const variance = computeVariance(value, compare, format, metricDef?.direction)
  const tone = sentimentTone(variance.sentiment)
  return (
    <div className={cn("flex flex-col gap-1 rounded-md border border-border p-3", state.refreshing && "opacity-60")}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold leading-tight text-foreground">{formatMetricValue(value, format, { compact: true })}</span>
      {state.result.comparison ? (
        <span className={cn("flex flex-wrap items-center gap-1 text-xs", toneInkClass(tone))}>
          <TrendIcon trend={variance.trend} />
          <span className="font-medium tabular-nums">{variance.ratioText}</span>
          <span className="tabular-nums">({variance.amountText})</span>
          <span className="text-muted-foreground">vs {state.result.comparison.label.toLowerCase()}</span>
        </span>
      ) : null}
      <span className="text-xs text-muted-foreground">{state.result.period.label}</span>
    </div>
  )
}

type TableVariant = "detail" | "statement" | "comparison"

interface TableConfig {
  variant: TableVariant
  dataset: string
  metric?: string
  metrics?: string[]
  rows?: string
  groupRows?: string
  period?: DatasetQuery["period"]
  compareWith?: "previous-period" | "previous-year" | "budget" | "forecast" | "none"
  filters?: DatasetQuery["filters"]
  totals?: { label: string; groups: string[] }[]
  title?: string
  limit?: number
}

const STATEMENT_TYPES = new Set(["IncomeStatement", "BalanceSheet", "CashFlowStatement"])

function tableConfig(type: string, props: ComponentRenderProps["element"]["props"]): TableConfig | null {
  const json = resolvedProps(props)
  if (STATEMENT_TYPES.has(type)) {
    const parsed = GENUI_COMPONENTS.IncomeStatement.props.safeParse(json)
    return parsed.success ? { variant: "statement", ...parsed.data } : null
  }
  const parsed = GENUI_COMPONENTS.FinancialTable.props.safeParse(json)
  if (!parsed.success) return null
  return { ...parsed.data, variant: parsed.data.variant ?? (parsed.data.metrics ? "detail" : "comparison") }
}

function tableQuery(config: TableConfig, drill: ReturnType<typeof useDrillState>): DatasetQuery | null {
  const metrics = config.metrics ?? (config.metric ? [config.metric] : [])
  if (metrics.length === 0) return null
  const groupBy = [config.groupRows, config.rows].filter((dimension): dimension is string => Boolean(dimension))
  const compare = config.variant === "detail" ? undefined : compareOf(config.compareWith)
  const filters = withDrillFilter(config.filters, drill)
  return {
    metrics,
    groupBy,
    ...(config.period ? { period: config.period } : {}),
    ...(compare ? { compare } : {}),
    ...(filters && filters.length > 0 ? { filters } : {}),
    ...(config.rows ? { sort: { by: config.rows, direction: "asc" as const } } : {}),
    limit: config.limit ?? 500,
  }
}

const TABLE_TITLES: Readonly<Record<string, string>> = {
  IncomeStatement: "Income statement",
  BalanceSheet: "Balance sheet",
  CashFlowStatement: "Cash flow statement",
}

export function FinancialTableElement({ element }: ComponentRenderProps) {
  const config = useMemo(() => tableConfig(element.type, element.props), [element.type, element.props])
  const decl = useDatasetDecl(config?.dataset)
  const drill = useDrillState(config?.dataset)
  const query = useMemo(() => (config ? tableQuery(config, drill) : null), [config, drill])
  const state = useDatasetQuery(config?.dataset, query)
  if (!config || !query) return <PropsIssue component={element.type} />
  const title = config.title ?? TABLE_TITLES[element.type]
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      {title ? <figcaption className="text-sm font-medium text-foreground">{title}</figcaption> : null}
      {drill && decl ? (
        <p className="text-xs text-muted-foreground">
          Filtered to {dimensionLabel(drill.dimension, decl.dimensions?.[drill.dimension]).toLowerCase()} {drill.value}
        </p>
      ) : null}
      {state.status !== "ok" ? <DataStateNotice state={state} /> : null}
      {state.status === "ok" && decl ? (
        <div className={cn(state.refreshing && "opacity-60")}>
          <FinancialTableBody element={element} config={config} query={query} result={state.result} decl={decl} />
        </div>
      ) : null}
    </figure>
  )
}

function useSelectorValue(value: string | undefined, binding: string | undefined, fallback: string): [string, (next: string) => void] {
  const [bound, setBound] = useBoundProp(value, binding)
  return [bound ?? fallback, setBound]
}

function SelectorShell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

const DEFAULT_PERIOD_OPTIONS = ["last-12-months", "ytd", "last-4-quarters", "last-3-months", "all"] as const

export function PeriodSelectorElement({ element, bindings }: ComponentRenderProps) {
  const parsed = GENUI_COMPONENTS.PeriodSelector.props.safeParse(resolvedProps(element.props))
  const options = parsed.success ? parsed.data.options ?? [...DEFAULT_PERIOD_OPTIONS] : []
  const [value, setValue] = useSelectorValue(parsed.success ? parsed.data.value : undefined, bindings?.value, options[0] ?? "all")
  if (!parsed.success) return <PropsIssue component="PeriodSelector" />
  const choices = options.includes(value) ? options : [value, ...options]
  return (
    <SelectorShell label={parsed.data.label ?? "Period"}>
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
        <SelectContent>
          {choices.map((option) => <SelectItem key={option} value={option}>{describePeriodSpec(option)}</SelectItem>)}
        </SelectContent>
      </Select>
    </SelectorShell>
  )
}

export function CompareSelectorElement({ element, bindings }: ComponentRenderProps) {
  const { spec } = useGenUIView()
  const parsed = GENUI_COMPONENTS.CompareSelector.props.safeParse(resolvedProps(element.props))
  const scenarios = useMemo(() => {
    const declared = Object.values(spec.datasets ?? {}).flatMap((decl) => [decl.scenario?.budget ? "budget" : null, decl.scenario?.forecast ? "forecast" : null])
    return new Set(declared)
  }, [spec.datasets])
  const defaults = [...COMPARE_MODES.filter((mode) => mode.startsWith("previous") || scenarios.has(mode)), "none" as const]
  const options = parsed.success ? parsed.data.options ?? defaults : []
  const [value, setValue] = useSelectorValue(parsed.success ? parsed.data.value : undefined, bindings?.value, options[0] ?? "none")
  if (!parsed.success) return <PropsIssue component="CompareSelector" />
  return (
    <SelectorShell label={parsed.data.label ?? "Compare with"}>
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option} value={option}>{describeCompareMode(option)}</SelectItem>)}
        </SelectContent>
      </Select>
    </SelectorShell>
  )
}

export function DimensionSelectorElement({ element, bindings }: ComponentRenderProps) {
  const isCurrency = element.type === "CurrencySelector"
  const props = useMemo(() => {
    const json = resolvedProps(element.props)
    if (isCurrency) {
      const parsed = GENUI_COMPONENTS.CurrencySelector.props.safeParse(json)
      return parsed.success ? { ...parsed.data, includeAll: false } : null
    }
    const parsed = GENUI_COMPONENTS.EntitySelector.props.safeParse(json)
    return parsed.success ? parsed.data : null
  }, [element.props, isCurrency])
  const decl = useDatasetDecl(props?.dataset)
  const firstMetric = decl ? Object.keys(decl.metrics)[0] : undefined
  const query = useMemo((): DatasetQuery | null => (
    props && firstMetric ? { metrics: [firstMetric], groupBy: [props.dimension], sort: { by: props.dimension, direction: "asc" }, limit: 200 } : null
  ), [firstMetric, props])
  const state = useDatasetQuery(props?.dataset, query)
  const values = state.status === "ok" ? state.result.rows.map((row) => row.dimensions[props?.dimension ?? ""] ?? "") : []
  const fallback = props?.includeAll === false || isCurrency ? values[0] ?? "" : ALL_VALUES
  const [value, setValue] = useSelectorValue(props?.value, bindings?.value, fallback)
  if (!props) return <PropsIssue component={element.type} />
  const label = props.label ?? (isCurrency ? "Currency" : dimensionLabel(props.dimension, decl?.dimensions?.[props.dimension]))
  if (state.status !== "ok") return <SelectorShell label={label}><DataStateNotice state={state} /></SelectorShell>
  const options = [...(props.includeAll === false || isCurrency ? [] : [ALL_VALUES]), ...values]
  return (
    <SelectorShell label={label}>
      <Select value={value || fallback} onValueChange={setValue}>
        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option} value={option}>{option === ALL_VALUES ? "All" : option}</SelectItem>)}
        </SelectContent>
      </Select>
    </SelectorShell>
  )
}
