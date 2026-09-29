import type { MetricDef, MetricFormat } from "./datasets"

export interface ValueFormat {
  format: MetricFormat
  currency?: string
  decimals?: number
}

export interface FormatOptions {
  compact?: boolean
  signed?: boolean
  accounting?: boolean
  locale?: string
}

export type Trend = "up" | "down" | "flat"
export type Sentiment = "positive" | "negative" | "neutral"

export interface Variance {
  amount: number | null
  ratio: number | null
  amountText: string
  ratioText: string
  trend: Trend
  sentiment: Sentiment
}

const DEFAULT_LOCALE = "en-US"
export const MISSING_VALUE = "—"

export function valueFormatOf(metric: MetricDef | undefined): ValueFormat {
  return {
    format: metric?.format ?? "number",
    ...(metric?.currency ? { currency: metric.currency } : {}),
    ...(metric?.decimals !== undefined ? { decimals: metric.decimals } : {}),
  }
}

export function formatMetricValue(value: number | null, format: ValueFormat, options: FormatOptions = {}): string {
  if (value === null || !Number.isFinite(value)) return MISSING_VALUE
  const locale = options.locale ?? DEFAULT_LOCALE
  const magnitude = options.accounting ? Math.abs(value) : value
  const body = formatMagnitude(magnitude, format, options, locale)
  if (options.accounting && value < 0) return `(${body})`
  if (options.signed && value > 0) return `+${body}`
  return body
}

function formatMagnitude(value: number, format: ValueFormat, options: FormatOptions, locale: string): string {
  if (format.format === "percent") {
    return new Intl.NumberFormat(locale, {
      style: "percent",
      minimumFractionDigits: format.decimals ?? 1,
      maximumFractionDigits: format.decimals ?? 1,
    }).format(value)
  }
  const currency = format.format === "currency" ? format.currency ?? "USD" : undefined
  const useSymbol = currency !== undefined && !options.accounting
  if (options.compact) {
    return new Intl.NumberFormat(locale, {
      ...(useSymbol ? { style: "currency", currency } : {}),
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(value)
  }
  const decimals = format.decimals ?? defaultDecimals(value, currency)
  return new Intl.NumberFormat(locale, {
    ...(useSymbol ? { style: "currency", currency } : {}),
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

function defaultDecimals(value: number, currency: string | undefined): number {
  if (currency || Number.isInteger(value)) return 0
  return 2
}

function trendOf(amount: number): Trend {
  if (amount > 0) return "up"
  if (amount < 0) return "down"
  return "flat"
}

function sentimentOf(trend: Trend, direction: MetricDef["direction"]): Sentiment {
  if (trend === "flat") return "neutral"
  const good = direction === "lower-is-better" ? trend === "down" : trend === "up"
  return good ? "positive" : "negative"
}

export function formatBasisPoints(deltaRatio: number, locale = DEFAULT_LOCALE): string {
  const bps = Math.round(deltaRatio * 10_000)
  const text = new Intl.NumberFormat(locale).format(Math.abs(bps))
  if (bps === 0) return "0 bps"
  return `${bps > 0 ? "+" : "−"}${text} bps`
}

export function formatSignedRatio(ratio: number, locale = DEFAULT_LOCALE): string {
  const text = new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(ratio))
  if (Math.abs(ratio) < 0.0005) return "0.0%"
  return `${ratio > 0 ? "+" : "−"}${text}`
}

export function computeVariance(
  value: number | null,
  compare: number | null,
  format: ValueFormat,
  direction: MetricDef["direction"] = "higher-is-better",
  locale = DEFAULT_LOCALE,
): Variance {
  if (value === null || compare === null) {
    return { amount: null, ratio: null, amountText: MISSING_VALUE, ratioText: MISSING_VALUE, trend: "flat", sentiment: "neutral" }
  }
  const amount = value - compare
  const ratio = compare === 0 ? null : amount / Math.abs(compare)
  const trend = trendOf(amount)
  const sentiment = sentimentOf(trend, direction)
  const amountText = format.format === "percent"
    ? formatBasisPoints(amount, locale)
    : signedMagnitude(amount, format, locale)
  return {
    amount,
    ratio,
    amountText,
    ratioText: ratio === null ? MISSING_VALUE : formatSignedRatio(ratio, locale),
    trend,
    sentiment,
  }
}

function signedMagnitude(amount: number, format: ValueFormat, locale: string): string {
  if (amount === 0) return formatMetricValue(0, format, { compact: true, locale })
  const text = formatMetricValue(Math.abs(amount), format, { compact: true, locale })
  return `${amount > 0 ? "+" : "−"}${text}`
}
