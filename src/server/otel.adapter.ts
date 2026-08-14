/**
 * Observability bootstrap — the ONLY file that may import the OTel SDK,
 * exporters, or perform observability IO. Domain code imports the pure
 * facade in `observability.ts`; with this adapter never initialized every
 * facade call is an api-package no-op.
 *
 * Three independent concerns, each with its own switch, because they answer
 * different incidents:
 *
 * 1. OTel traces + metrics — full-system tracing to an OTLP collector.
 *    Gated by the user-facing telemetry setting (Settings → telemetry.enabled,
 *    runtime-applied via applyTelemetrySettings) with KANNA_OTEL as the env
 *    override in both directions; precedence lives in otel-config.ts. Each
 *    install reports under `kanna-<machine name>` so distinct distributions
 *    stay distinguishable at the collector.
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
import { resetMetricInstrumentCache } from "./observability"
import { resolveOtelConfig, type ResolvedOtelConfig, type TelemetrySettingsInput } from "./otel-config"

export interface ObservabilityHandle {
  /** Flushes and tears down whatever was started. Safe to call once. */
  shutdown(): Promise<void>
  /**
   * Re-resolves OTel export against the new telemetry setting and restarts or
   * stops the providers accordingly — the Settings toggle applies without a
   * server restart. Serialized internally; safe to call at any time.
   */
  applyTelemetrySettings(telemetry: TelemetrySettingsInput): void
}

export interface InitObservabilityArgs {
  dataDir: string
  telemetry?: TelemetrySettingsInput
  machineName?: string
}

function positiveIntEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function startOtel(config: ResolvedOtelConfig): () => Promise<void> {
  const resource = resourceFromAttributes({
    "service.name": config.serviceName,
    "host.name": config.machineName,
  })
  const tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter(config.traceUrl ? { url: config.traceUrl } : {})),
    ],
  })
  tracerProvider.register()
  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(config.metricUrl ? { url: config.metricUrl } : {}),
        exportIntervalMillis: positiveIntEnv(process.env.KANNA_OTEL_METRIC_INTERVAL_MS, 15_000),
      }),
    ],
  })
  metrics.setGlobalMeterProvider(meterProvider)
  resetMetricInstrumentCache()
  registerMemoryGauges()
  log.info("[kanna/otel] tracing + metrics enabled", {
    serviceName: config.serviceName,
    endpoint: config.traceUrl
      ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      ?? "http://localhost:4318 (default)",
  })
  return async () => {
    await tracerProvider.shutdown()
    await meterProvider.shutdown()
    // Clear the api globals so a later start can register fresh providers
    // (the api setter refuses to overwrite an existing registration).
    trace.disable()
    metrics.disable()
    resetMetricInstrumentCache()
  }
}

/**
 * Starts every enabled observability concern. Called once from server boot.
 * Never throws: a broken collector endpoint must not take the server down —
 * observability failing closed means flying blind, not crashing.
 */
export function initObservability(args: InitObservabilityArgs): ObservabilityHandle {
  const teardowns: Array<() => Promise<void> | void> = []
  let otelTeardown: (() => Promise<void>) | null = null
  let otelConfig: ResolvedOtelConfig | null = null
  // Serializes start/stop transitions so a rapid toggle cannot interleave a
  // provider shutdown with the next registration.
  let transition: Promise<void> = Promise.resolve()

  const startFromConfig = (config: ResolvedOtelConfig | null) => {
    otelConfig = config
    if (!config) return
    try {
      otelTeardown = startOtel(config)
    } catch (err) {
      otelTeardown = null
      log.warn("[kanna/otel] init failed; continuing without export", { err })
    }
  }

  const readOtelEnv = () => ({
    KANNA_OTEL: process.env.KANNA_OTEL,
    KANNA_OTEL_SERVICE_NAME: process.env.KANNA_OTEL_SERVICE_NAME,
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  })

  startFromConfig(resolveOtelConfig({
    env: readOtelEnv(),
    telemetry: args.telemetry,
    machineName: args.machineName ?? "",
  }))

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
      await transition.catch(() => undefined)
      const otel = otelTeardown
      otelTeardown = null
      if (otel) {
        try {
          await otel()
        } catch (err) {
          log.warn("[kanna/otel] teardown failed", { err })
        }
      }
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

    applyTelemetrySettings(telemetry) {
      const next = resolveOtelConfig({
        env: readOtelEnv(),
        telemetry,
        machineName: args.machineName ?? "",
      })
      if (JSON.stringify(next) === JSON.stringify(otelConfig)) return
      otelConfig = next
      transition = transition.then(async () => {
        const previous = otelTeardown
        otelTeardown = null
        if (previous) {
          try {
            await previous()
          } catch (err) {
            log.warn("[kanna/otel] teardown failed", { err })
          }
        }
        startFromConfig(next)
        if (!next) log.info("[kanna/otel] tracing + metrics disabled via settings")
      })
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
