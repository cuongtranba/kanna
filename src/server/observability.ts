/**
 * Domain-facing observability facade.
 *
 * Imports ONLY `@opentelemetry/api` — the pure, dependency-free instrument
 * surface. When no SDK is registered (KANNA_OTEL off, and every test run)
 * each call resolves to the api package's no-op implementations, so
 * instrumented code paths cost nothing and need no test doubles. The SDK,
 * exporters, and every side effect live in `otel.adapter.ts`; domain modules
 * must never import that adapter, only this facade.
 *
 * Side-effect seal: no IO, no env, no process access here.
 */

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

/** Resident set size of the server process, sampled at each metric collection. */
export const PROCESS_RSS_BYTES = "kanna.process.rss_bytes"

/** One increment per finished subagent run, keyed by outcome. */
export const SUBAGENT_RUN_FINISHED = "kanna.subagent.run.finished"

/** End-to-end wall clock of one chat turn, spawn included. */
export const TURN_DURATION_MS = "kanna.turn.duration_ms"

/** End-to-end wall clock of one delegated subagent run. */
export const SUBAGENT_RUN_DURATION_MS = "kanna.subagent.run.duration_ms"

/**
 * Tokens billed for one chat turn, split by `kind` — the only metric that
 * answers "what is this install spending", which turn and run counts cannot:
 * a 200k-token turn and a 2k-token turn are one turn each.
 *
 * One instrument with a `kind` attribute rather than three named metrics, so
 * `sum by (kind)` separates them and a bare `sum` is the billable total. A new
 * token class the providers start reporting is a new attribute VALUE, not a
 * new metric name an alert rule would have to learn.
 *
 * Attributes are `provider`, `model` and `kind` — deliberately NOT `chat_id`,
 * which is unbounded and would multiply the fleet's series count by every chat
 * anyone ever opens. High-cardinality identity belongs on spans.
 *
 * The `kind` values PARTITION the billed tokens (see `splitBilledTokens`), so
 * a bare `sum` is the total and never double-counts.
 */
export const TURN_TOKENS = "kanna.turn.tokens"

/**
 * What the provider says one turn cost, in USD. Recorded only when the
 * provider reports it: a turn whose cost is unknown records nothing rather
 * than a zero, because a zero is indistinguishable from "free" and would drag
 * any fleet total toward it. PTY-mode turns have no price resolver wired, so
 * this metric is deliberately sparser than `TURN_TOKENS`.
 */
export const TURN_COST_USD = "kanna.turn.cost_usd"

/**
 * Tokens billed for one delegated subagent run, split the same way as
 * `TURN_TOKENS`. Separate from it because a subagent run is not a chat turn
 * and never passes through the turn-terminal choke point — and because a loop
 * spends most of its budget here, where turn counts show nothing at all.
 */
export const SUBAGENT_TOKENS = "kanna.subagent.tokens"

/**
 * Explicit bucket boundaries for the duration histograms above, in ms.
 *
 * OTel's default boundaries stop at 10s. A turn runs seconds to tens of
 * minutes, so under the defaults every observation lands in the +Inf bucket and
 * `histogram_quantile` — the only reason to record a histogram rather than a
 * counter — cannot tell a healthy turn from a pathological one. These are
 * spaced so a normal fleet's p95 and a regressed one's fall in different
 * buckets across that whole range.
 */
export const DURATION_BUCKETS_MS: readonly number[] = [
  1_000, 2_000, 5_000, 10_000, 20_000, 30_000,
  60_000, 120_000, 300_000, 600_000, 1_200_000, 1_800_000,
]

/**
 * One instrumentation scope for the whole server. Span names carry the
 * subsystem (`kanna.turn.start`, `kanna.subagent.run`), so a per-module
 * scope would only fragment the trace view.
 */
const SCOPE = "kanna"

/**
 * Runs `fn` inside an active span. The span is parented to the ambient
 * context (AsyncLocalStorage under the node SDK), so nested `withSpan`
 * calls — a subagent run inside a loop wake — form a real trace tree
 * without any handle threading.
 *
 * A throw is recorded on the span and re-thrown untouched: instrumentation
 * must never change control flow.
 */
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

// Instruments are cached by name: the SDK deduplicates identical
// registrations, but re-creating one per call-site invocation still pays a
// map lookup inside the SDK and spams its duplicate-instrument bookkeeping.
const counters = new Map<string, Counter>()
const upDowns = new Map<string, UpDownCounter>()
const histograms = new Map<string, Histogram>()

/**
 * A cached instrument is bound to the meter provider that created it, so a
 * runtime provider swap (telemetry toggled in Settings) would leave every
 * cached counter recording into a shut-down provider. The adapter calls this
 * on each provider transition; the next add() re-resolves from the global.
 */
export function resetMetricInstrumentCache(): void {
  counters.clear()
  upDowns.clear()
  histograms.clear()
}

/** Increments a monotonic counter (e.g. turns started, wakes recovered). */
export function addCounter(name: string, value: number, attributes?: Attributes): void {
  let counter = counters.get(name)
  if (!counter) {
    counter = metrics.getMeter(SCOPE).createCounter(name)
    counters.set(name, counter)
  }
  counter.add(value, attributes)
}

/** Adjusts a non-monotonic gauge-like value (e.g. live subagent runs). */
export function recordUpDown(name: string, value: number, attributes?: Attributes): void {
  let instrument = upDowns.get(name)
  if (!instrument) {
    instrument = metrics.getMeter(SCOPE).createUpDownCounter(name)
    upDowns.set(name, instrument)
  }
  instrument.add(value, attributes)
}

/**
 * Records one observation of a distribution (e.g. a turn's duration in ms).
 *
 * Bucket boundaries are a provider-side concern: the adapter registers a view
 * over DURATION_BUCKETS_MS, and without a registered SDK this is a no-op like
 * every other facade call.
 */
export function recordHistogram(name: string, value: number, attributes?: Attributes): void {
  let instrument = histograms.get(name)
  if (!instrument) {
    instrument = metrics.getMeter(SCOPE).createHistogram(name)
    histograms.set(name, instrument)
  }
  instrument.record(value, attributes)
}
