import { afterEach, describe, test, expect } from "bun:test"
import {
  withSpan,
  addCounter,
  recordUpDown,
  recordHistogram,
  DURATION_BUCKETS_MS,
  PACKAGE_APPLY_DURATION_MS,
  TURN_DURATION_MS,
} from "./observability"
import { startMetricRecorder, type MetricRecorder } from "./test-helpers/metric-recorder"

// No provider is registered in tests, so every call runs against the
// @opentelemetry/api no-op implementations — the exact configuration the
// production server has when KANNA_OTEL is off. The contract under test is
// "instrumentation must be invisible": values pass through, errors propagate,
// and nothing throws for lack of an SDK.

describe("withSpan", () => {
  test("returns the wrapped function's value", async () => {
    expect(await withSpan("test.span", { a: 1 }, async () => 42)).toBe(42)
  })

  test("propagates the wrapped function's throw", async () => {
    await expect(
      withSpan("test.span", {}, async () => { throw new Error("inner failure") }),
    ).rejects.toThrow("inner failure")
  })

  test("passes the span handle to the wrapped function", async () => {
    let sawSpan = false
    await withSpan("test.span", {}, async (span) => {
      sawSpan = typeof span.setAttribute === "function"
    })
    expect(sawSpan).toBe(true)
  })
})

describe("metric helpers", () => {
  test("addCounter is a safe no-op without an SDK", () => {
    expect(() => {
      addCounter("kanna.test.counter", 1, { source: "test" })
      addCounter("kanna.test.counter", 2)
    }).not.toThrow()
  })

  test("recordUpDown is a safe no-op without an SDK", () => {
    expect(() => {
      recordUpDown("kanna.test.updown", 5)
      recordUpDown("kanna.test.updown", -5)
    }).not.toThrow()
  })

  test("recordHistogram is a safe no-op without an SDK", () => {
    expect(() => {
      recordHistogram("kanna.test.duration_ms", 1234, { provider: "claude" })
    }).not.toThrow()
  })
})

// These register a real SDK meter provider, so they assert what was RECORDED
// rather than that recording is harmless. Disposal is not optional — see
// test-helpers/metric-recorder.ts.
describe("recordHistogram against a real meter provider", () => {
  let recorder: MetricRecorder | null = null

  afterEach(async () => {
    await recorder?.dispose()
    recorder = null
  })

  test("records the observation with its attributes", async () => {
    recorder = startMetricRecorder()
    recordHistogram(TURN_DURATION_MS, 4_000, { provider: "claude", outcome: "finished" })
    recordHistogram(TURN_DURATION_MS, 6_000, { provider: "claude", outcome: "finished" })
    recordHistogram(TURN_DURATION_MS, 1_000, { provider: "codex", outcome: "failed" })

    const points = await recorder.histogram(TURN_DURATION_MS)
    const claude = points.find((p) => p.attributes.provider === "claude")
    const codex = points.find((p) => p.attributes.provider === "codex")

    expect(claude).toMatchObject({ count: 2, sum: 10_000 })
    expect(claude?.attributes).toEqual({ provider: "claude", outcome: "finished" })
    expect(codex).toMatchObject({ count: 1, sum: 1_000 })
  })

  // The regression this pins: OTel's DEFAULT explicit buckets top out at
  // 10_000 ms. A Kanna turn runs 10s-10min, so under the defaults every
  // observation falls in the +Inf bucket and histogram_quantile — the whole
  // point of the metric — returns garbage.
  test("turn-length durations land in distinct finite buckets", async () => {
    recorder = startMetricRecorder({ buckets: { [TURN_DURATION_MS]: DURATION_BUCKETS_MS } })
    const durations = [5_000, 30_000, 120_000, 600_000]
    for (const ms of durations) recordHistogram(TURN_DURATION_MS, ms, { provider: "claude" })

    const [point] = await recorder.histogram(TURN_DURATION_MS)
    if (!point) throw new Error("no histogram recorded")

    expect(point.count).toBe(durations.length)
    expect(point.counts.at(-1)).toBe(0)
    const occupied = point.counts.filter((n) => n > 0)
    expect(occupied).toEqual([1, 1, 1, 1])
  })

  test("buckets reach beyond the longest plausible turn", () => {
    expect(Math.max(...DURATION_BUCKETS_MS)).toBeGreaterThanOrEqual(1_800_000)
    expect([...DURATION_BUCKETS_MS]).toEqual([...DURATION_BUCKETS_MS].sort((a, b) => a - b))
  })

  // Pins that a 45s package apply — a realistic slow skill install — lands in a
  // distinct finite bucket rather than +Inf (which would make histogram_quantile
  // useless for diagnosing slow applies).
  test("45s package apply lands in a finite bucket", async () => {
    recorder = startMetricRecorder({ buckets: { [PACKAGE_APPLY_DURATION_MS]: DURATION_BUCKETS_MS } })
    recordHistogram(PACKAGE_APPLY_DURATION_MS, 45_000, { kind: "skill", ok: "true", trigger: "manual" })

    const [point] = await recorder.histogram(PACKAGE_APPLY_DURATION_MS)
    if (!point) throw new Error("no histogram recorded")

    expect(point.count).toBe(1)
    expect(point.counts.at(-1)).toBe(0) // not in +Inf
  })
})
