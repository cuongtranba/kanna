import { describe, expect, test } from "bun:test"
import { createClaudeHarnessStream } from "./claude-harness-stream"
import type { ClaudeRawSdkMessage } from "./claude-message-normalizer"
import type { HarnessEvent } from "./harness-types"
import type { ModelPrice } from "../shared/token-pricing"

function fakeQuery(messages: unknown[]): AsyncGenerator<ClaudeRawSdkMessage> {
  return (async function* () {
    for (const m of messages) yield m as ClaudeRawSdkMessage
  })()
}

async function collect(
  messages: unknown[],
  configuredContextWindow?: number,
  resolveTurnPrice?: () => ModelPrice | null,
): Promise<HarnessEvent[]> {
  const events: HarnessEvent[] = []
  for await (const ev of createClaudeHarnessStream(
    fakeQuery(messages),
    configuredContextWindow,
    resolveTurnPrice,
  )) {
    events.push(ev)
  }
  return events
}

describe("createClaudeHarnessStream", () => {
  test("empty stream yields nothing", async () => {
    const events = await collect([])
    expect(events).toHaveLength(0)
  })

  test("session_token event emitted when sdkMessage.session_id is present", async () => {
    const events = await collect([
      {
        type: "assistant",
        session_id: "sess-abc",
        message: { id: "m1", role: "assistant", content: [] },
      },
    ])
    const tokens = events.filter((e) => e.type === "session_token")
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toEqual({ type: "session_token", sessionToken: "sess-abc" })
  })

  test("no session_token event when session_id is absent", async () => {
    const events = await collect([
      {
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 0,
        uuid: "r1",
      },
    ])
    const tokens = events.filter((e) => e.type === "session_token")
    expect(tokens).toHaveLength(0)
  })

  test("rate_limit_event with resetsAt produces rate_limit HarnessEvent", async () => {
    const resetAt = 1_748_800_000
    const events = await collect([
      {
        type: "rate_limit_event",
        session_id: "sess-rl",
        rate_limit_info: { status: "rejected", resetsAt: resetAt },
      },
    ])
    const rateLimits = events.filter((e) => e.type === "rate_limit")
    expect(rateLimits).toHaveLength(1)
    const ev = rateLimits[0]
    expect(ev.type).toBe("rate_limit")
    // SDK emits resetsAt as epoch seconds; limit-detector converts to ms
    expect(ev.rateLimit?.resetAt).toBe(resetAt * 1000)
  })

  test("assistant message emits context_window_updated transcript entry", async () => {
    const events = await collect([
      {
        type: "assistant",
        session_id: "sess-1",
        message: { id: "m1", role: "assistant", content: [{ type: "text", text: "hello" }] },
        usage: { input_tokens: 100, output_tokens: 30 },
      },
    ])
    const cwUpdated = events.filter(
      (e) => e.type === "transcript" && e.entry?.kind === "context_window_updated",
    )
    expect(cwUpdated.length).toBeGreaterThanOrEqual(1)
  })

  test("result message produces enriched result entry with usage", async () => {
    const events = await collect([
      {
        type: "assistant",
        session_id: "sess-u",
        message: { id: "m1", role: "assistant", content: [] },
        usage: { input_tokens: 50, output_tokens: 20 },
      },
      {
        type: "result",
        subtype: "success",
        session_id: "sess-u",
        is_error: false,
        duration_ms: 300,
        usage: { input_tokens: 50, output_tokens: 20 },
        uuid: "r1",
      },
    ])
    const resultEntries = events.flatMap((e) =>
      e.type === "transcript" && e.entry?.kind === "result" ? [e.entry] : [],
    )
    expect(resultEntries).toHaveLength(1)
    expect(resultEntries[0].usage).toBeDefined()
  })

  test("api_error in turn scrubs result body (no duplicate text)", async () => {
    const errorText = "You've hit your limit"
    const events = await collect([
      {
        type: "assistant",
        session_id: "sess-ae",
        uuid: "msg-err",
        isApiErrorMessage: true,
        message: {
          model: "<synthetic>",
          content: [{ type: "text", text: errorText }],
        },
      },
      {
        type: "result",
        subtype: "error",
        session_id: "sess-ae",
        is_error: true,
        result: errorText,
        duration_ms: 1000,
        uuid: "r-ae",
      },
    ])
    const apiErrorEntries = events.flatMap((e) =>
      e.type === "transcript" && e.entry?.kind === "api_error" ? [e.entry] : [],
    )
    const resultEntries = events.flatMap((e) =>
      e.type === "transcript" && e.entry?.kind === "result" ? [e.entry] : [],
    )
    expect(apiErrorEntries).toHaveLength(1)
    expect(resultEntries).toHaveLength(1)
    // Result body is scrubbed to "" to avoid duplicate display
    expect(resultEntries[0].result).toBe("")
  })

  test("normalizeClaudeStreamMessage entries are yielded as transcript events", async () => {
    const events = await collect([
      {
        type: "result",
        subtype: "success",
        session_id: "sess-norm",
        is_error: false,
        result: "done",
        duration_ms: 50,
        uuid: "r-norm",
      },
    ])
    const transcriptEntries = events.filter((e) => e.type === "transcript")
    expect(transcriptEntries.length).toBeGreaterThanOrEqual(1)
  })

  test("result with total_cost_usd attaches costUsd to result entry", async () => {
    const events = await collect([
      {
        type: "result",
        subtype: "success",
        session_id: "sess-cost",
        is_error: false,
        duration_ms: 100,
        total_cost_usd: 0.0042,
        uuid: "r-cost",
      },
    ])
    const resultEntries = events.flatMap((e) =>
      e.type === "transcript" && e.entry?.kind === "result" ? [e.entry] : [],
    )
    expect(resultEntries).toHaveLength(1)
    expect(resultEntries[0].costUsd).toBe(0.0042)
  })

  test("resolveTurnPrice callback used when total_cost_usd absent", async () => {
    const price: ModelPrice = { inputPerMTok: 3, outputPerMTok: 15, cachedInputPerMTok: 0.3 }
    const events = await collect(
      [
        {
          type: "assistant",
          session_id: "sess-price",
          message: { id: "m1", role: "assistant", content: [] },
          usage: { input_tokens: 1000, output_tokens: 100 },
        },
        {
          type: "result",
          subtype: "success",
          session_id: "sess-price",
          is_error: false,
          duration_ms: 100,
          usage: { input_tokens: 1000, output_tokens: 100 },
          uuid: "r-price",
        },
      ],
      undefined,
      () => price,
    )
    const resultEntries = events.flatMap((e) =>
      e.type === "transcript" && e.entry?.kind === "result" ? [e.entry] : [],
    )
    expect(resultEntries).toHaveLength(1)
    expect(typeof resultEntries[0].costUsd).toBe("number")
    expect((resultEntries[0].costUsd as number)).toBeGreaterThan(0)
  })

  test("duplicate assistant usage id is not double-counted", async () => {
    const events = await collect([
      {
        type: "assistant",
        session_id: "sess-dup",
        message: { id: "dup-id", role: "assistant", content: [] },
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      {
        type: "assistant",
        session_id: "sess-dup",
        message: { id: "dup-id", role: "assistant", content: [] },
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    ])
    const cwUpdated = events.filter(
      (e) => e.type === "transcript" && e.entry?.kind === "context_window_updated",
    )
    // Only one context_window_updated per unique usage id
    expect(cwUpdated).toHaveLength(1)
  })

  test("configuredContextWindow floors the context window from SDK", async () => {
    const events = await collect(
      [
        {
          type: "assistant",
          session_id: "sess-1m",
          message: { id: "m1", role: "assistant", content: [] },
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        {
          type: "result",
          subtype: "success",
          session_id: "sess-1m",
          is_error: false,
          duration_ms: 100,
          usage: { input_tokens: 100, output_tokens: 50 },
          modelUsage: { "claude-sonnet-4-6": { contextWindow: 200_000 } },
          uuid: "r-1m",
        },
      ],
      1_000_000,
    )
    const cwUpdated = events.flatMap((e) =>
      e.type === "transcript" && e.entry?.kind === "context_window_updated" ? [e.entry] : [],
    )
    // The configuredContextWindow (1M) should prevail over modelUsage (200K)
    const lastSnapshot = cwUpdated[cwUpdated.length - 1]
    expect(lastSnapshot).toBeDefined()
    // maxTokens in the snapshot should reflect the 1M floor, not the 200K from modelUsage
    expect(lastSnapshot.usage.maxTokens).toBeGreaterThanOrEqual(1_000_000)
  })
})
