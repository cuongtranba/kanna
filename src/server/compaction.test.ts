import { afterEach, describe, expect, test } from "bun:test"
import {
  COMPACTION_FINISHED,
  COMPACTION_POST_TOKENS,
  COMPACTION_PRE_TOKENS,
  COMPACTION_STARTED,
  COMPACTION_TOKEN_BUCKETS,
} from "./observability"
import {
  buildCompactSummaryEntry,
  compactSummaryMessageId,
  recordCompactionFinished,
  recordCompactionStarted,
} from "./compaction"
import { startMetricRecorder, type MetricRecorder } from "./test-helpers/metric-recorder"

const buckets = {
  [COMPACTION_PRE_TOKENS]: COMPACTION_TOKEN_BUCKETS,
  [COMPACTION_POST_TOKENS]: COMPACTION_TOKEN_BUCKETS,
}

describe("compaction metrics", () => {
  let recorder: MetricRecorder | null = null

  afterEach(async () => {
    await recorder?.dispose()
    recorder = null
  })

  test("a finished compaction records the counter and both token sizes", async () => {
    recorder = startMetricRecorder({ buckets })

    recordCompactionFinished("claude", {
      trigger: "auto",
      preTokens: 206978,
      postTokens: 7509,
      durationMs: 143806,
    })

    const [finished] = await recorder.counter(COMPACTION_FINISHED)
    expect(finished?.value).toBe(1)
    expect(finished?.attributes).toEqual({ provider: "claude", trigger: "auto" })

    const [pre] = await recorder.histogram(COMPACTION_PRE_TOKENS)
    expect(pre?.count).toBe(1)
    expect(pre?.sum).toBe(206978)
    expect(pre?.attributes).toEqual({ provider: "claude", trigger: "auto" })

    const [post] = await recorder.histogram(COMPACTION_POST_TOKENS)
    expect(post?.sum).toBe(7509)
  })

  test("a real pre-token count lands in a finite bucket, not +Inf", async () => {
    recorder = startMetricRecorder({ buckets })

    recordCompactionFinished("claude", { trigger: "auto", preTokens: 206978 })

    const [pre] = await recorder.histogram(COMPACTION_PRE_TOKENS)
    expect(pre?.counts.at(-1)).toBe(0)
    expect(pre?.counts.reduce((sum, n) => sum + n, 0)).toBe(1)
  })

  test("partitions by provider and trigger so a rate can be derived per kind", async () => {
    recorder = startMetricRecorder({ buckets })

    recordCompactionFinished("claude", { trigger: "auto", preTokens: 1 })
    recordCompactionFinished("claude", { trigger: "manual", preTokens: 1 })
    recordCompactionFinished("codex", { trigger: "auto", preTokens: 1 })

    const byKey = new Map(
      (await recorder.counter(COMPACTION_FINISHED)).map((point) => [
        `${String(point.attributes.provider)}/${String(point.attributes.trigger)}`,
        point.value,
      ]),
    )
    expect(byKey.get("claude/auto")).toBe(1)
    expect(byKey.get("claude/manual")).toBe(1)
    expect(byKey.get("codex/auto")).toBe(1)
  })

  test("absent metadata still counts the compaction, as trigger unknown", async () => {
    recorder = startMetricRecorder({ buckets })

    recordCompactionFinished("codex", undefined)

    const [finished] = await recorder.counter(COMPACTION_FINISHED)
    expect(finished?.value).toBe(1)
    expect(finished?.attributes).toEqual({ provider: "codex", trigger: "unknown" })
  })

  test("an absent token count records no observation rather than a zero", async () => {
    recorder = startMetricRecorder({ buckets })

    recordCompactionFinished("claude", { trigger: "manual" })

    expect(await recorder.histogram(COMPACTION_PRE_TOKENS)).toEqual([])
    expect(await recorder.histogram(COMPACTION_POST_TOKENS)).toEqual([])
  })

  test("an unknown provider is reported as unknown, never dropped", async () => {
    recorder = startMetricRecorder({ buckets })

    recordCompactionFinished(undefined, { trigger: "auto" })

    const [finished] = await recorder.counter(COMPACTION_FINISHED)
    expect(finished?.attributes).toEqual({ provider: "unknown", trigger: "auto" })
  })

  test("a started compaction is counted separately from a finished one", async () => {
    recorder = startMetricRecorder({ buckets })

    recordCompactionStarted("claude", "manual")

    const [started] = await recorder.counter(COMPACTION_STARTED)
    expect(started?.value).toBe(1)
    expect(started?.attributes).toEqual({ provider: "claude", trigger: "manual" })
    expect(await recorder.counter(COMPACTION_FINISHED)).toEqual([])
  })
})

describe("buildCompactSummaryEntry", () => {
  test("carries the summary so the history primer can cross the boundary", () => {
    const entry = buildCompactSummaryEntry({ sessionId: "sess-1", summary: "  Wired the hooks.  " })
    expect(entry?.kind).toBe("compact_summary")
    expect(entry?.summary).toBe("Wired the hooks.")
  })

  test("the same compaction yields the same messageId, so a re-fire dedupes", () => {
    const a = buildCompactSummaryEntry({ sessionId: "sess-1", summary: "same" })
    const b = buildCompactSummaryEntry({ sessionId: "sess-1", summary: "same" })
    expect(a?.messageId).toBe(b?.messageId ?? "")
    expect(a?._id).not.toBe(b?._id ?? "")
  })

  test("a different session or summary yields a different messageId", () => {
    const base = compactSummaryMessageId("sess-1", "one")
    expect(compactSummaryMessageId("sess-2", "one")).not.toBe(base)
    expect(compactSummaryMessageId("sess-1", "two")).not.toBe(base)
  })

  test("an empty summary produces nothing rather than a blank transcript row", () => {
    expect(buildCompactSummaryEntry({ sessionId: "sess-1", summary: "   " })).toBeNull()
  })
})
