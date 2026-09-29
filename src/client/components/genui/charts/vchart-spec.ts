import type {
  IAreaChartSpec,
  IBarChartSpec,
  ICartesianAxisSpec,
  ICommonChartSpec,
  ILineChartSpec,
  IPieChartSpec,
  IRangeColumnChartSpec,
  Datum,
  ISpec,
  ITooltipSpec,
} from "@visactor/vchart"
import { formatMetricValue } from "../../../../shared/genui"
import type { ChartModel, ChartPoint, ChartSeries } from "./chart-model"
import type { ChartTheme } from "./chart-theme"

export const BAR_MAX_WIDTH = 24
export const LINE_WIDTH = 2
export const POINT_SIZE = 8
export const AREA_OPACITY = 0.1
const COMPARE_DASH = [4, 3]
const LABEL_FONT_SIZE = 11

export interface ChartDatum {
  x: string
  xLabel: string
  series: string
  seriesLabel: string
  value: number
  start: number
  end: number
}

function datumOf(point: ChartPoint, labels: ReadonlyMap<string, string>): ChartDatum {
  return {
    x: point.x,
    xLabel: point.xLabel,
    series: point.series,
    seriesLabel: labels.get(point.series) ?? point.series,
    value: point.value,
    start: point.start ?? 0,
    end: point.end ?? point.value,
  }
}

export function seriesColor(series: ChartSeries, theme: ChartTheme): string {
  switch (series.role) {
    case "compare":
      return theme.compare
    case "increase":
      return theme.increase
    case "decrease":
      return theme.decrease
    case "total":
      return theme.total
    default:
      return theme.series[series.slot ?? 0] ?? theme.series[0] ?? theme.text
  }
}

function colorScale(model: ChartModel, theme: ChartTheme) {
  return { type: "ordinal" as const, domain: model.series.map((series) => series.label), range: model.series.map((series) => seriesColor(series, theme)) }
}

function isCompareSeries(model: ChartModel, label: string): boolean {
  return model.series.some((series) => series.label === label && series.role === "compare")
}

const SERIES_FIELD = "seriesLabel"

function readField(datum: Datum | undefined, field: "series" | "seriesLabel" | "xLabel"): string {
  const value = datum?.[field]
  return typeof value === "string" ? value : ""
}

function readValue(datum: Datum | undefined): number | null {
  const value = datum?.value
  return typeof value === "number" ? value : null
}

function tooltip(model: ChartModel): ITooltipSpec {
  const value = (datum: Datum | undefined) => formatMetricValue(readValue(datum), model.format)
  return {
    mark: {
      title: { value: (datum: Datum | undefined) => readField(datum, "xLabel") },
      content: [{ key: (datum: Datum | undefined) => readField(datum, "seriesLabel"), value }],
    },
    dimension: {
      title: { value: (datum: Datum | undefined) => readField(datum, "xLabel") },
      content: [{ key: (datum: Datum | undefined) => readField(datum, "seriesLabel"), value }],
    },
  }
}

function showsEveryCategory(model: ChartModel): boolean {
  return model.kind !== "line" && model.kind !== "area"
}

function axes(model: ChartModel, theme: ChartTheme): ICartesianAxisSpec[] {
  const labelStyle = { fill: theme.mutedText, fontSize: LABEL_FONT_SIZE, fontFamily: theme.fontFamily }
  return [
    {
      orient: "left",
      type: "linear",
      label: { style: labelStyle, formatMethod: (value) => formatMetricValue(Number(value), model.format, { compact: true }) },
      grid: { visible: true, style: { stroke: theme.grid, lineWidth: 1, lineDash: [] } },
      domainLine: { visible: false },
      tick: { visible: false },
    },
    {
      orient: "bottom",
      type: "band",
      sampling: !showsEveryCategory(model),
      label: { style: labelStyle, autoLimit: true, formatMethod: (value) => model.xLabels[String(value)] ?? String(value) },
      domainLine: { visible: true, style: { stroke: theme.axis, lineWidth: 1 } },
      tick: { visible: false },
      grid: { visible: false },
    },
  ]
}

function legends(model: ChartModel, theme: ChartTheme) {
  return {
    visible: model.series.length >= 2,
    orient: "top" as const,
    position: "start" as const,
    item: { label: { style: { fill: theme.text, fontSize: LABEL_FONT_SIZE, fontFamily: theme.fontFamily } } },
  }
}

function shared(model: ChartModel, theme: ChartTheme) {
  const labels = new Map(model.series.map((series) => [series.id, series.label]))
  return {
    data: [{ id: "points", values: model.points.map((point) => datumOf(point, labels)) }],
    background: "transparent",
    padding: { top: 8, right: 12, bottom: 4, left: 4 },
    color: colorScale(model, theme),
    tooltip: tooltip(model),
    legends: legends(model, theme),
  }
}

export function buildVChartSpec(model: ChartModel, theme: ChartTheme): ISpec {
  switch (model.kind) {
    case "line":
      return lineSpec(model, theme)
    case "area":
      return areaSpec(model, theme)
    case "bar":
    case "stacked-bar":
      return barSpec(model, theme)
    case "combo":
      return comboSpec(model, theme)
    case "waterfall":
      return waterfallSpec(model, theme)
    case "composition":
      return compositionSpec(model, theme)
  }
}

function crosshair(theme: ChartTheme) {
  return { xField: { visible: true, line: { type: "line" as const, style: { stroke: theme.axis, lineWidth: 1 } } } }
}

function lineSpec(model: ChartModel, theme: ChartTheme): ILineChartSpec {
  return {
    type: "line",
    ...shared(model, theme),
    xField: "x",
    yField: "value",
    seriesField: SERIES_FIELD,
    axes: axes(model, theme),
    crosshair: crosshair(theme),
    line: { style: { lineWidth: LINE_WIDTH, lineCap: "round", lineJoin: "round", lineDash: (datum: Datum | undefined) => (isCompareSeries(model, readField(datum, "seriesLabel")) ? COMPARE_DASH : []) } },
    point: { style: { size: POINT_SIZE, stroke: theme.surface, lineWidth: 2 } },
  }
}

function areaSpec(model: ChartModel, theme: ChartTheme): IAreaChartSpec {
  return {
    type: "area",
    ...shared(model, theme),
    xField: "x",
    yField: "value",
    seriesField: SERIES_FIELD,
    axes: axes(model, theme),
    crosshair: crosshair(theme),
    line: { style: { lineWidth: LINE_WIDTH, lineCap: "round", lineJoin: "round" } },
    area: { style: { fillOpacity: (datum: Datum | undefined) => (isCompareSeries(model, readField(datum, "seriesLabel")) ? 0 : AREA_OPACITY) } },
    point: { visible: false },
  }
}

function barSpec(model: ChartModel, theme: ChartTheme): IBarChartSpec {
  const stacked = model.kind === "stacked-bar"
  const grouped = !stacked && model.series.length > 1
  return {
    type: "bar",
    ...shared(model, theme),
    xField: grouped ? ["x", SERIES_FIELD] : "x",
    yField: "value",
    seriesField: SERIES_FIELD,
    stack: stacked,
    barMaxWidth: BAR_MAX_WIDTH,
    barGapInGroup: 2,
    axes: axes(model, theme),
    bar: { style: { cornerRadius: stacked ? 0 : [4, 4, 0, 0], stroke: theme.surface, lineWidth: stacked ? 2 : 0 } },
  }
}

function comboSpec(model: ChartModel, theme: ChartTheme): ICommonChartSpec {
  const [bars, line] = model.series
  const base = shared(model, theme)
  const labels = new Map(model.series.map((series) => [series.id, series.label]))
  const valuesOf = (id: string | undefined) => model.points.filter((point) => point.series === id).map((point) => datumOf(point, labels))
  return {
    type: "common",
    background: base.background,
    padding: base.padding,
    color: base.color,
    tooltip: base.tooltip,
    legends: base.legends,
    data: [{ id: "bars", values: valuesOf(bars?.id) }, { id: "line", values: valuesOf(line?.id) }],
    series: [
      { type: "bar", dataIndex: 0, xField: "x", yField: "value", seriesField: SERIES_FIELD, barMaxWidth: BAR_MAX_WIDTH, bar: { style: { cornerRadius: [4, 4, 0, 0] } } },
      { type: "line", dataIndex: 1, xField: "x", yField: "value", seriesField: SERIES_FIELD, line: { style: { lineWidth: LINE_WIDTH } }, point: { style: { size: POINT_SIZE, stroke: theme.surface, lineWidth: 2 } } },
    ],
    axes: axes(model, theme).map((axis) => (axis.orient === "left" ? { ...axis, seriesIndex: [0, 1] } : axis)),
  }
}

function waterfallSpec(model: ChartModel, theme: ChartTheme): IRangeColumnChartSpec {
  return {
    type: "rangeColumn",
    ...shared(model, theme),
    xField: "x",
    minField: "start",
    maxField: "end",
    seriesField: SERIES_FIELD,
    barMaxWidth: BAR_MAX_WIDTH,
    axes: axes(model, theme),
    bar: { style: { cornerRadius: 2 } },
  }
}

function compositionSpec(model: ChartModel, theme: ChartTheme): IPieChartSpec {
  return {
    type: "pie",
    ...shared(model, theme),
    categoryField: SERIES_FIELD,
    valueField: "value",
    innerRadius: 0.62,
    outerRadius: 0.9,
    pie: { style: { stroke: theme.surface, lineWidth: 2 } },
  }
}
