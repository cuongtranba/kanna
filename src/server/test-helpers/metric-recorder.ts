
import { metrics, type Attributes } from "@opentelemetry/api"
import {
  AggregationTemporality,
  AggregationType,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type DataPoint,
  type Histogram,
} from "@opentelemetry/sdk-metrics"
import { resetMetricInstrumentCache } from "../observability"

export interface RecordedHistogram {
  attributes: Attributes
  count: number
  sum: number
  boundaries: number[]
  counts: number[]
}

export interface RecordedCounter {
  attributes: Attributes
  value: number
}

export interface MetricRecorder {
  histogram(name: string): Promise<RecordedHistogram[]>
  counter(name: string): Promise<RecordedCounter[]>
  dispose(): Promise<void>
}

export interface MetricRecorderOptions {
  buckets?: Record<string, readonly number[]>
}

export function startMetricRecorder(options: MetricRecorderOptions = {}): MetricRecorder {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE)
  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 2_147_483_647,
  })
  const provider = new MeterProvider({
    readers: [reader],
    views: Object.entries(options.buckets ?? {}).map(([instrumentName, boundaries]) => ({
      instrumentName,
      aggregation: {
        type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM as const,
        options: { boundaries: [...boundaries] },
      },
    })),
  })
  metrics.disable()
  metrics.setGlobalMeterProvider(provider)
  resetMetricInstrumentCache()

  function pointsNamed<T>(name: string): DataPoint<T>[] {
    const points: DataPoint<T>[] = []
    for (const resourceMetric of exporter.getMetrics()) {
      for (const scope of resourceMetric.scopeMetrics) {
        for (const metric of scope.metrics) {
          if (metric.descriptor.name !== name) continue
          points.push(...(metric.dataPoints as DataPoint<T>[]))
        }
      }
    }
    return points
  }

  return {
    async histogram(name) {
      await provider.forceFlush()
      return pointsNamed<Histogram>(name).map((point) => ({
        attributes: point.attributes,
        count: point.value.count,
        sum: point.value.sum ?? 0,
        boundaries: point.value.buckets.boundaries,
        counts: point.value.buckets.counts,
      }))
    },

    async counter(name) {
      await provider.forceFlush()
      return pointsNamed<number>(name).map((point) => ({
        attributes: point.attributes,
        value: point.value,
      }))
    },

    async dispose() {
      await provider.shutdown()
      metrics.disable()
      resetMetricInstrumentCache()
      exporter.reset()
    },
  }
}
