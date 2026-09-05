
import {
  metrics,
  trace,
  SpanStatusCode,
  type Attributes,
  type Counter,
  type Histogram,
  type Span,
  type UpDownCounter,
} from "@opentelemetry/api"

export const PROCESS_RSS_BYTES = "kanna.process.rss_bytes"

export const SUBAGENT_RUN_FINISHED = "kanna.subagent.run.finished"

export const TURN_DURATION_MS = "kanna.turn.duration_ms"

export const SUBAGENT_RUN_DURATION_MS = "kanna.subagent.run.duration_ms"

export const TURN_TOKENS = "kanna.turn.tokens"

export const TURN_COST_USD = "kanna.turn.cost_usd"

export const SUBAGENT_TOKENS = "kanna.subagent.tokens"

export const PACKAGE_CHECK_FINISHED = "kanna.packages.check_finished"

export const PACKAGE_APPLY_FINISHED = "kanna.packages.apply_finished"

export const PACKAGE_UPDATE_RATE_LIMITED = "kanna.packages.update_rate_limited"

export const PACKAGE_CHECK_DURATION_MS = "kanna.packages.check_duration_ms"

export const PACKAGE_APPLY_DURATION_MS = "kanna.packages.apply_duration_ms"

export const DURATION_BUCKETS_MS: readonly number[] = [
  1_000, 2_000, 5_000, 10_000, 20_000, 30_000,
  60_000, 120_000, 300_000, 600_000, 1_200_000, 1_800_000,
]

const SCOPE = "kanna"

export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return trace.getTracer(SCOPE).startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span)
      span.setStatus({ code: SpanStatusCode.OK })
      return result
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)))
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
      throw error
    } finally {
      span.end()
    }
  })
}

const counters = new Map<string, Counter>()
const upDowns = new Map<string, UpDownCounter>()
const histograms = new Map<string, Histogram>()

export function resetMetricInstrumentCache(): void {
  counters.clear()
  upDowns.clear()
  histograms.clear()
}

export function addCounter(name: string, value: number, attributes?: Attributes): void {
  let counter = counters.get(name)
  if (!counter) {
    counter = metrics.getMeter(SCOPE).createCounter(name)
    counters.set(name, counter)
  }
  counter.add(value, attributes)
}

export function recordUpDown(name: string, value: number, attributes?: Attributes): void {
  let instrument = upDowns.get(name)
  if (!instrument) {
    instrument = metrics.getMeter(SCOPE).createUpDownCounter(name)
    upDowns.set(name, instrument)
  }
  instrument.add(value, attributes)
}

export function recordHistogram(name: string, value: number, attributes?: Attributes): void {
  let instrument = histograms.get(name)
  if (!instrument) {
    instrument = metrics.getMeter(SCOPE).createHistogram(name)
    histograms.set(name, instrument)
  }
  instrument.record(value, attributes)
}
