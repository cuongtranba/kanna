import type { ChartModel } from "./chart-model"

export interface ChartPointRef {
  x: string
  series: string
}

export interface ChartRendererProps {
  model: ChartModel
  height: number
  label: string
  onPointClick: ((point: ChartPointRef) => void) | null
}

export function chartPointFromDatum(model: ChartModel, datum: { x?: string | number; series?: string | number } | null | undefined): ChartPointRef | null {
  if (!datum || datum.x === undefined) return null
  const x = String(datum.x)
  if (!model.xOrder.includes(x) || model.kind === "waterfall" && x === model.xOrder[model.xOrder.length - 1]) return null
  return { x, series: datum.series === undefined ? "" : String(datum.series) }
}
