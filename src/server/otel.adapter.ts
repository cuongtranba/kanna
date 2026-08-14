/**
 * Observability bootstrap — the ONLY file that may import the OTel SDK,
 * exporters, or perform observability IO. Domain code imports the pure
 * facade in `observability.ts`; with this adapter never initialized every
 * facade call is an api-package no-op.
 *
 * Three independent concerns, each with its own switch, because they answer
 * different incidents:
 *
 * 1. OTel traces + metrics (KANNA_OTEL=enabled) — full-system tracing to an
 *    OTLP collector. Off by default: it opens sockets.
 * 2. Memory log line (KANNA_MEMLOG_MS, default 60000, 0 disables) — one
 *    rss/heap line per minute in the server log. This is what correlates the
 *    NEXT OOM kill with what the process was doing; three OOMs at 1.06-2.43 GB
 *    went undiagnosed for lack of exactly this.
 * 3. Heap snapshot on SIGUSR2 (KANNA_HEAP_SNAPSHOT=disabled opts out) —
 *    `kill -USR2 <pid>` writes a Chrome-DevTools-loadable snapshot under
 *    <dataDir>/heap-snapshots. The only way to answer "WHAT is holding the
 *    bytes" on a live process.
 */

import fs from "node:fs"
import path from "node:path"
import { metrics, trace } from "@opentelemetry/api"
import { NodeTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-node"
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { log } from "../shared/log"

export interface ObservabilityHandle {
  /** Flushes and tears down whatever was started. Safe to call once. */
  shutdown(): Promise<void>
}

function positiveIntEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/**
 * Starts every enabled observability concern. Called once from server boot.
 * Never throws: a broken collector endpoint must not take the server down —
 * observability failing closed means flying blind, not crashing.
 */
export function initObservability(args: { dataDir: string }): ObservabilityHandle {
  const teardowns: Array<() => Promise<void> | void> = []

  try {
    if (process.env.KANNA_OTEL === "enabled") {
      const resource = resourceFromAttributes({
        "service.name": process.env.KANNA_OTEL_SERVICE_NAME ?? "kanna",
      })
      const tracerProvider = new NodeTracerProvider({
        resource,
        spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
      })
      tracerProvider.register()
      const meterProvider = new MeterProvider({
        resource,
        readers: [
          new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter(),
            exportIntervalMillis: positiveIntEnv(process.env.KANNA_OTEL_METRIC_INTERVAL_MS, 15_000),
          }),
        ],
      })
      metrics.setGlobalMeterProvider(meterProvider)
      registerMemoryGauges()
      teardowns.push(() => tracerProvider.shutdown())
      teardowns.push(() => meterProvider.shutdown())
      log.info("[kanna/otel] tracing + metrics enabled", {
        endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318 (default)",
      })
    }
  } catch (err) {
    log.warn("[kanna/otel] init failed; continuing without export", { err })
  }

  const memlogMs = positiveIntEnv(process.env.KANNA_MEMLOG_MS, 60_000)
  if (memlogMs > 0) {
    const timer = setInterval(() => {
      const usage = process.memoryUsage()
      const mb = (n: number) => Math.round(n / 1048576)
      log.info(
        `[kanna/mem] rss=${mb(usage.rss)}MB heapUsed=${mb(usage.heapUsed)}MB`
        + ` heapTotal=${mb(usage.heapTotal)}MB external=${mb(usage.external)}MB`,
      )
    }, memlogMs)
    timer.unref?.()
    teardowns.push(() => clearInterval(timer))
  }

  if (process.env.KANNA_HEAP_SNAPSHOT !== "disabled") {
    const onSigusr2 = () => {
      try {
        const dir = path.join(args.dataDir, "heap-snapshots")
        fs.mkdirSync(dir, { recursive: true })
        const stamp = new Date().toISOString().replace(/[:.]/g, "-")
        const file = path.join(dir, `kanna-${stamp}.heapsnapshot`)
        // v8 format loads directly in Chrome DevTools' Memory tab.
        fs.writeFileSync(file, Bun.generateHeapSnapshot("v8"))
        log.info("[kanna/mem] heap snapshot written", { file })
      } catch (err) {
        log.warn("[kanna/mem] heap snapshot failed", { err })
      }
    }
    process.on("SIGUSR2", onSigusr2)
    teardowns.push(() => { process.off("SIGUSR2", onSigusr2) })
  }

  return {
    async shutdown() {
      for (const teardown of teardowns.splice(0)) {
        try {
          await teardown()
        } catch (err) {
          log.warn("[kanna/otel] teardown failed", { err })
        }
      }
      trace.disable()
      metrics.disable()
    },
  }
}

/**
 * Observable gauges read process.memoryUsage at each metric collection —
 * the OTel-side twin of the memlog line, for dashboards instead of grep.
 */
function registerMemoryGauges(): void {
  const meter = metrics.getMeter("kanna")
  const rss = meter.createObservableGauge("kanna.process.rss_bytes")
  const heapUsed = meter.createObservableGauge("kanna.process.heap_used_bytes")
  const heapTotal = meter.createObservableGauge("kanna.process.heap_total_bytes")
  const external = meter.createObservableGauge("kanna.process.external_bytes")
  meter.addBatchObservableCallback(
    (result) => {
      const usage = process.memoryUsage()
      result.observe(rss, usage.rss)
      result.observe(heapUsed, usage.heapUsed)
      result.observe(heapTotal, usage.heapTotal)
      result.observe(external, usage.external)
    },
    [rss, heapUsed, heapTotal, external],
  )
}
