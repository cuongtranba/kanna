import { lazy, Suspense, useCallback, useMemo } from "react"
import { useActions, useStateValue, type ComponentRenderProps } from "@json-render/react"
import { ChevronLeft, MessageSquareText } from "lucide-react"
import {
  describeCompareMode,
  describePeriodSpec,
  dimensionLabel,
  formatMetricValue,
  GENUI_COMPONENTS,
  metricLabel,
  type DatasetDecl,
  type DatasetQuery,
} from "../../../../shared/genui"
import type { JsonObject } from "../../../../shared/json"
import { Button } from "../../ui/button"
import { SegmentedControl } from "../../ui/segmented-control"
import { cn } from "../../../lib/utils"
import { pendingActionKey, runPendingAction, usePendingAction } from "../../../stores/pendingActionsStore"
import { drillStatePath, drillStateSchema, type DrillState } from "../actions"
import { buildChartModel, type ChartKind, type ChartModel } from "../charts/chart-model"
import type { ChartPointRef, ChartRendererProps } from "../charts/chart-renderer"
import { useGenUIHost } from "../host"
import { useDatasetDecl, useDatasetQuery } from "../useDatasetQuery"
import { useElementUiState } from "../useElementUiState"
import type { JsonValue } from "../../../../shared/json"
import { useGenUIView } from "../view-context"
import { DataStateNotice, EmptyNotice, PropsIssue } from "./primitives"
import { compareOf, resolvedProps, withDrillFilter } from "./props"

const LazyVChartSurface = lazy(() => import("../charts/VChartSurface"))

const CHART_HEIGHT = { sm: 200, md: 260, lg: 340 } as const

function isChartView(value: JsonValue | undefined): value is "chart" | "table" {
  return value === "chart" || value === "table"
}
const DEFAULT_CHART_LIMIT = 60

type ChartProps = NonNullable<ReturnType<typeof parseChartProps>>

function parseChartProps(props: ComponentRenderProps["element"]["props"]) {
  const json = resolvedProps(props)
  if (!json) return null
  const parsed = GENUI_COMPONENTS.FinancialChart.props.safeParse(json)
  return parsed.success ? parsed.data : null
}

export function useDrillState(datasetId: string | undefined): DrillState | null {
  const raw = useStateValue<JsonObject>(drillStatePath(datasetId ?? ""))
  return useMemo(() => {
    if (!datasetId || !raw) return null
    const parsed = drillStateSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  }, [datasetId, raw])
}

function chartQuery(props: ChartProps, drill: DrillState | null): DatasetQuery {
  const metrics = Array.isArray(props.metric) ? props.metric : [props.metric]
  const dimension = drill ? drill.into : props.dimension
  const period = drill?.period ?? props.period
  const compare = props.chart === "waterfall" || props.chart === "composition" || drill ? undefined : compareOf(props.compareWith)
  const filters = withDrillFilter(props.filters, drill)
  return {
    metrics: props.secondaryMetric ? [...metrics, props.secondaryMetric] : metrics,
    groupBy: props.series && !drill ? [dimension, props.series] : [dimension],
    ...(period ? { period } : {}),
    ...(compare ? { compare } : {}),
    ...(filters && filters.length > 0 ? { filters } : {}),
    ...(props.chart === "waterfall" ? { sort: { by: dimension, direction: "asc" as const } } : {}),
    limit: props.limit ?? DEFAULT_CHART_LIMIT,
  }
}

function chartKind(props: ChartProps, drill: DrillState | null): ChartKind {
  if (!drill) return props.chart
  return props.chart === "composition" ? "composition" : "bar"
}

function ChartTable({ model }: { model: ChartModel }) {
  const series = model.series.filter((entry) => model.points.some((point) => point.series === entry.id))
  const value = (x: string, id: string) => model.points.find((point) => point.x === x && point.series === id)?.value ?? null
  return (
    <div className="max-h-80 overflow-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border">
            <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{model.dimensionLabel}</th>
            {series.map((entry) => (
              <th key={entry.id} scope="col" className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">{entry.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {model.xOrder.map((x) => (
            <tr key={x}>
              <th scope="row" className="px-3 py-1.5 text-left font-normal text-foreground">{model.xLabels[x] ?? x}</th>
              {series.map((entry) => (
                <td key={entry.id} className="px-3 py-1.5 text-right tabular-nums text-foreground">{formatMetricValue(value(x, entry.id), model.format)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ChartSurface({ model, height, onPointClick }: { model: ChartModel; height: number; onPointClick: ChartRendererProps["onPointClick"] }) {
  const host = useGenUIHost()
  const Renderer = host.ChartRenderer ?? LazyVChartSurface
  const label = `${model.valueLabel} by ${model.dimensionLabel.toLowerCase()}, ${model.points.length} values. Switch to Table to read them.`
  return (
    <Suspense fallback={<div className="w-full" style={{ height }} aria-hidden="true" />}>
      <Renderer model={model} height={height} label={label} onPointClick={onPointClick} />
    </Suspense>
  )
}

function ExplainButton({ props, drill }: { props: ChartProps; drill: DrillState | null }) {
  const { execute } = useActions()
  const { viewKey } = useGenUIView()
  const host = useGenUIHost()
  const key = pendingActionKey("genui.financial.explainVariance", viewKey, props.dataset)
  const pending = usePendingAction(key)
  const metric = Array.isArray(props.metric) ? props.metric[0] ?? "" : props.metric
  const handleExplain = useCallback(() => {
    const filters = withDrillFilter(props.filters, drill)
    const period = drill?.period ?? props.period
    runPendingAction(key, () => execute({
      action: "financial.explainVariance",
      params: {
        dataset: props.dataset,
        metric,
        compareWith: compareOf(props.compareWith) ?? "previous-period",
        ...(period ? { period } : {}),
        ...(filters && filters.length > 0 ? { filters: filters.map((filter) => ({ ...filter })) } : {}),
      },
    }))
  }, [drill, execute, key, metric, props])
  if (host.readonly || !host.sendToAgent) return null
  return (
    <Button size="sm" variant="ghost" pending={pending} onClick={handleExplain}>
      {pending ? null : <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />}
      Explain variance
    </Button>
  )
}

function DrillBreadcrumb({ datasetId, drill, decl }: { datasetId: string; drill: DrillState; decl: DatasetDecl }) {
  const { execute } = useActions()
  const { viewKey } = useGenUIView()
  const key = pendingActionKey("genui.drill.back", viewKey, datasetId)
  const pending = usePendingAction(key)
  const handleBack = useCallback(() => {
    runPendingAction(key, () => execute({ action: "setState", params: { statePath: drillStatePath(datasetId), value: null } }))
  }, [datasetId, execute, key])
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Button size="sm" variant="ghost" onClick={handleBack} pending={pending}>
        {pending ? null : <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />}
        Back
      </Button>
      <span>
        {dimensionLabel(drill.dimension, decl.dimensions?.[drill.dimension])}: <span className="text-foreground">{drill.value}</span>
        {" "}by {dimensionLabel(drill.into, decl.dimensions?.[drill.into]).toLowerCase()}
      </span>
    </div>
  )
}

function chartSubtitle(props: ChartProps, result: { period: { label: string }; comparison?: { label: string } } | null): string {
  const period = result ? result.period.label : describePeriodSpec(props.period)
  const compare = compareOf(props.compareWith)
  const comparisonLabel = result?.comparison?.label ?? (compare ? describeCompareMode(compare) : null)
  return comparisonLabel ? `${period} · vs ${comparisonLabel.toLowerCase()}` : period
}

export function FinancialChartElement({ element }: ComponentRenderProps) {
  const props = useMemo(() => parseChartProps(element.props), [element.props])
  const decl = useDatasetDecl(props?.dataset)
  const drill = useDrillState(props?.drilldown ? props.dataset : undefined)
  const query = useMemo(() => (props ? chartQuery(props, drill) : null), [props, drill])
  const state = useDatasetQuery(props?.dataset, query)
  const [view, setView] = useElementUiState(element, "view", "chart", isChartView)
  const { execute } = useActions()
  const { viewKey } = useGenUIView()
  const drillKey = pendingActionKey("genui.financial.drilldown", viewKey, props?.dataset ?? "")
  const drillPending = usePendingAction(drillKey)

  const modelResult = useMemo(() => {
    if (!props || !decl || state.status !== "ok") return null
    const metrics = Array.isArray(props.metric) ? props.metric : [props.metric]
    return buildChartModel({
      chart: chartKind(props, drill),
      metrics,
      ...(props.secondaryMetric ? { secondaryMetric: props.secondaryMetric } : {}),
      dimension: drill ? drill.into : props.dimension,
      ...(props.series && !drill ? { series: props.series } : {}),
      ...(props.totalLabel ? { totalLabel: props.totalLabel } : {}),
    }, decl, state.result)
  }, [decl, drill, props, state])

  const drilldown = props?.drilldown
  const onPointClick = useCallback((point: ChartPointRef) => {
    if (!props || !drilldown || drill) return
    const metric = Array.isArray(props.metric) ? props.metric[0] ?? "" : props.metric
    runPendingAction(drillKey, () => execute({
      action: "financial.drilldown",
      params: { dataset: props.dataset, metric, dimension: props.dimension, value: point.x, into: drilldown.dimension, ...(props.period ? { period: props.period } : {}) },
    }))
  }, [drill, drillKey, drilldown, execute, props])

  if (!props) return <PropsIssue component="FinancialChart" />
  const height = CHART_HEIGHT[props.height ?? "md"]
  const metricId = Array.isArray(props.metric) ? props.metric[0] ?? "" : props.metric
  const title = props.title ?? metricLabel(metricId, decl?.metrics[metricId])
  const subtitle = chartSubtitle(props, state.status === "ok" ? state.result : null)

  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        </div>
        <div className="flex items-center gap-1">
          {props.explain ? <ExplainButton props={props} drill={drill} /> : null}
          <SegmentedControl size="sm" value={view} onValueChange={setView} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />
        </div>
      </figcaption>
      {drill && decl ? <DrillBreadcrumb datasetId={props.dataset} drill={drill} decl={decl} /> : null}
      {state.status !== "ok" ? <DataStateNotice state={state} minHeight={height} /> : null}
      {state.status === "ok" && modelResult && !modelResult.ok ? <EmptyNotice label={modelResult.message} minHeight={height} /> : null}
      {state.status === "ok" && modelResult?.ok && modelResult.model.points.length === 0 ? <EmptyNotice label="No data for the selected period" minHeight={height} /> : null}
      {state.status === "ok" && modelResult?.ok && modelResult.model.points.length > 0 ? (
        <div className={cn("transition-opacity duration-[var(--motion-quick)]", (state.refreshing || drillPending) && "opacity-60")} aria-busy={drillPending || undefined}>
          {view === "chart"
            ? <ChartSurface model={modelResult.model} height={height} onPointClick={props.drilldown && !drill ? onPointClick : null} />
            : <ChartTable model={modelResult.model} />}
          {state.result.truncated ? <p className="mt-1 text-xs text-muted-foreground">Showing the first {state.result.rows.length} groups.</p> : null}
        </div>
      ) : null}
    </figure>
  )
}
