import { useEffect, useMemo, useRef } from "react"
import type { Datum, IVChart } from "@visactor/vchart"
import { domAdapter } from "../../../adapters/dom.adapter"
import { useOptionalResolvedTheme } from "../../../hooks/useTheme"
import { runDetached } from "../../../lib/runDetached"
import { chartPointFromDatum, type ChartRendererProps } from "./chart-renderer"
import { resolveChartTheme } from "./chart-theme"
import { buildVChartSpec } from "./vchart-spec"
import { VChart } from "./vchart-runtime"

function datumPoint(datum: Datum | undefined): { x?: string; series?: string } | null {
  if (!datum) return null
  const x = datum.x
  const series = datum.series
  return { ...(typeof x === "string" ? { x } : {}), ...(typeof series === "string" ? { series } : {}) }
}

export default function VChartSurface({ model, height, label, onPointClick }: ChartRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IVChart | null>(null)
  const clickRef = useRef(onPointClick)
  const modelRef = useRef(model)
  const themeName = useOptionalResolvedTheme()

  useEffect(() => {
    clickRef.current = onPointClick
    modelRef.current = model
  })

  const spec = useMemo(() => {
    void themeName
    return buildVChartSpec(model, resolveChartTheme((name, fallback) => domAdapter.getCssVar(name, fallback)))
  }, [model, themeName])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const chart = new VChart(spec, { dom: container, animation: false, autoFit: true })
    chartRef.current = chart
    chart.on("click", (params) => {
      const point = chartPointFromDatum(modelRef.current, datumPoint(params.datum))
      if (point) clickRef.current?.(point)
    })
    runDetached("render generated chart", chart.renderAsync())
    return () => {
      chartRef.current = null
      chart.release()
    }
  }, [spec])

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={label}
      className="w-full"
      style={{ height }}
    />
  )
}
