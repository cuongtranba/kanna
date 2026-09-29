import { oklchToRgbString, parseOklchColor } from "../../../../shared/design/contrast"
import { CATEGORICAL_SLOTS } from "./chart-model"

export interface ChartTheme {
  series: readonly string[]
  compare: string
  increase: string
  decrease: string
  total: string
  grid: string
  axis: string
  text: string
  mutedText: string
  surface: string
  fontFamily: string
}

export type CssVariableReader = (name: string, fallback: string) => string

function toCanvasColor(value: string, fallback: string): string {
  const oklch = parseOklchColor(value)
  if (oklch) return oklchToRgbString(oklch, oklch.alpha)
  return value.trim() || fallback
}

export function resolveChartTheme(read: CssVariableReader): ChartTheme {
  const color = (name: string, fallback: string) => toCanvasColor(read(name, ""), fallback)
  const series = Array.from({ length: CATEGORICAL_SLOTS }, (_, index) => color(`--chart-${index + 1}`, "rgb(42, 120, 214)"))
  const mutedText = color("--muted-foreground", "rgb(115, 107, 108)")
  return {
    series,
    compare: mutedText,
    increase: series[0] ?? mutedText,
    decrease: series[CATEGORICAL_SLOTS - 1] ?? mutedText,
    total: mutedText,
    grid: color("--chart-grid", "rgb(236, 232, 232)"),
    axis: color("--chart-axis", "rgb(204, 198, 198)"),
    text: color("--foreground", "rgb(30, 24, 25)"),
    mutedText,
    surface: color("--card", "rgb(255, 253, 253)"),
    fontFamily: read("--kanna-font-body", "ui-sans-serif, system-ui, sans-serif"),
  }
}
