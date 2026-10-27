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
import { defineElement } from "./define-element"
import { DataStateNotice, PropsIssue, sentimentTone, toneInkClass, TrendIcon } from "./primitives"
import { FinancialTableBody, type TableBodyConfig } from "./financial-table-body"
import { ALL_VALUES, compareOf, datasetQuery, metricListOf, withDrillFilter } from "./props"

export function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

export const FinancialMetricElement = defineElement(GENUI_COMPONENTS.FinancialMetric.props, ({ props }) => {
  const decl = useDatasetDecl(props.dataset)
  const drill = useDrillState(props.dataset)
  const query = useMemo(() => datasetQuery({
    metrics: [props.metric],
    period: props.period,
    compare: compareOf(props.compareWith),
    scenario: props.scenario,
    filters: withDrillFilter(props.filters, drill),
  }), [drill, props])
  const state = useDatasetQuery(props.dataset, query)

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
      {state.result.comparison && variance.amount !== null ? (
        <span className={cn("flex flex-wrap items-center gap-1 text-xs", toneInkClass(tone))}>
          <TrendIcon trend={variance.trend} />
          <span className="font-medium tabular-nums">{variance.ratioText}</span>
          <span className="tabular-nums">({variance.amountText})</span>
          <span className="text-muted-foreground">vs {lowerFirst(state.result.comparison.label)}</span>
        </span>
      ) : null}
      {state.result.comparison && variance.amount === null ? (
        <span className="text-xs text-muted-foreground">No {lowerFirst(state.result.comparison.label)} data to compare</span>
      ) : null}
      <span className="text-xs text-muted-foreground">{state.result.period.label}</span>
    </div>
  )
})

interface TableConfig extends TableBodyConfig {
  dataset: string
  period?: DatasetQuery["period"]
  compareWith?: "previous-period" | "previous-year" | "budget" | "forecast" | "none"
  filters?: DatasetQuery["filters"]
  title?: string
  limit?: number
}

function tableQuery(config: TableConfig, drill: ReturnType<typeof useDrillState>): DatasetQuery | null {
  if (config.metrics.length === 0) return null
  return datasetQuery({
    metrics: config.metrics,
    groupBy: [config.groupRows, config.rows].filter((dimension): dimension is string => Boolean(dimension)),
    period: config.period,
    compare: config.variant === "detail" ? undefined : compareOf(config.compareWith),
    filters: withDrillFilter(config.filters, drill),
    sort: config.rows ? { by: config.rows, direction: "asc" } : undefined,
    limit: config.limit ?? 500,
  })
}

function FinancialTableView({ element, config, defaultTitle }: { element: ComponentRenderProps["element"]; config: TableConfig; defaultTitle?: string }) {
  const decl = useDatasetDecl(config.dataset)
  const drill = useDrillState(config.dataset)
  const query = useMemo(() => tableQuery(config, drill), [config, drill])
  const state = useDatasetQuery(config.dataset, query)
  if (!query) return <PropsIssue component={element.type} />
  const title = config.title ?? defaultTitle
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
          <FinancialTableBody element={element} config={config} result={state.result} decl={decl} />
        </div>
      ) : null}
    </figure>
  )
}

export const FinancialTableElement = defineElement(GENUI_COMPONENTS.FinancialTable.props, ({ element, props }) => {
  const config = useMemo((): TableConfig => ({
    ...props,
    metrics: metricListOf(props),
    variant: props.variant ?? (props.metrics ? "detail" : "comparison"),
  }), [props])
  return <FinancialTableView element={element} config={config} />
})

export function statementTableElement(schema: typeof GENUI_COMPONENTS.IncomeStatement.props, defaultTitle: string) {
  return defineElement(schema, ({ element, props }) => {
    const config = useMemo((): TableConfig => ({ ...props, metrics: [props.metric], variant: "statement" }), [props])
    return <FinancialTableView element={element} config={config} defaultTitle={defaultTitle} />
  })
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

export const PeriodSelectorElement = defineElement(GENUI_COMPONENTS.PeriodSelector.props, ({ props, bindings }) => {
  const options = props.options ?? [...DEFAULT_PERIOD_OPTIONS]
  const [value, setValue] = useSelectorValue(props.value, bindings?.value, options[0] ?? "all")
  const choices = options.includes(value) ? options : [value, ...options]
  return (
    <SelectorShell label={props.label ?? "Period"}>
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
        <SelectContent>
          {choices.map((option) => <SelectItem key={option} value={option}>{describePeriodSpec(option)}</SelectItem>)}
        </SelectContent>
      </Select>
    </SelectorShell>
  )
})

export const CompareSelectorElement = defineElement(GENUI_COMPONENTS.CompareSelector.props, ({ props, bindings }) => {
  const { spec } = useGenUIView()
  const scenarios = useMemo(() => {
    const declared = Object.values(spec.datasets ?? {}).flatMap((decl) => [decl.scenario?.budget ? "budget" : null, decl.scenario?.forecast ? "forecast" : null])
    return new Set(declared)
  }, [spec.datasets])
  const defaults = [...COMPARE_MODES.filter((mode) => mode.startsWith("previous") || scenarios.has(mode)), "none" as const]
  const options = props.options ?? defaults
  const [value, setValue] = useSelectorValue(props.value, bindings?.value, options[0] ?? "none")
  return (
    <SelectorShell label={props.label ?? "Compare with"}>
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option} value={option}>{describeCompareMode(option)}</SelectItem>)}
        </SelectContent>
      </Select>
    </SelectorShell>
  )
})

interface DimensionSelectorProps {
  value?: string | undefined
  dataset: string
  dimension: string
  label?: string | undefined
  includeAll?: boolean | undefined
}

function DimensionSelectorView({ props, bindings, defaultLabel }: { props: DimensionSelectorProps; bindings: ComponentRenderProps["bindings"]; defaultLabel?: string }) {
  const decl = useDatasetDecl(props.dataset)
  const firstMetric = decl ? Object.keys(decl.metrics)[0] : undefined
  const { dimension } = props
  const query = useMemo((): DatasetQuery | null => (
    firstMetric ? datasetQuery({ metrics: [firstMetric], groupBy: [dimension], sort: { by: dimension, direction: "asc" }, limit: 200 }) : null
  ), [dimension, firstMetric])
  const state = useDatasetQuery(props.dataset, query)
  const values = state.status === "ok" ? state.result.rows.map((row) => row.dimensions[dimension] ?? "") : []
  const includeAll = props.includeAll !== false
  const fallback = includeAll ? ALL_VALUES : values[0] ?? ""
  const [value, setValue] = useSelectorValue(props.value, bindings?.value, fallback)
  const label = props.label ?? defaultLabel ?? dimensionLabel(dimension, decl?.dimensions?.[dimension])
  if (state.status !== "ok") return <SelectorShell label={label}><DataStateNotice state={state} /></SelectorShell>
  const options = [...(includeAll ? [ALL_VALUES] : []), ...values]
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

export const CurrencySelectorElement = defineElement(GENUI_COMPONENTS.CurrencySelector.props, ({ props, bindings }) => {
  const selectorProps = useMemo(() => ({ ...props, includeAll: false }), [props])
  return <DimensionSelectorView props={selectorProps} bindings={bindings} defaultLabel="Currency" />
})

export const EntitySelectorElement = defineElement(GENUI_COMPONENTS.EntitySelector.props, ({ props, bindings }) => {
  return <DimensionSelectorView props={props} bindings={bindings} />
})
