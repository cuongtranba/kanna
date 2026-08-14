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
  type Span,
  type UpDownCounter,
} from "@opentelemetry/api"

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
