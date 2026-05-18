import { describe, expect, test } from "bun:test"
import { parseJsonlLine, createJsonlEventParser } from "./jsonl-to-event"
import type { HarnessEvent } from "../harness-types"

describe("parseJsonlLine", () => {
  test("ignores empty lines", () => {
    expect(parseJsonlLine("")).toEqual([])
    expect(parseJsonlLine("   ")).toEqual([])
  })

  test("ignores malformed JSON (logs but does not throw)", () => {
    expect(parseJsonlLine("{not json")).toEqual([])
  })

  test("system.init → session_token event", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "sess-1",
      model: "claude-sonnet-4-6",
    })
    const events = parseJsonlLine(line)
    const sessionTokenEvent = events.find((e) => e.type === "session_token")
    expect(sessionTokenEvent).toBeDefined()
    expect(sessionTokenEvent?.sessionToken).toBe("sess-1")
  })

  test("assistant message → transcript event with assistant role", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
      },
    })
    const events = parseJsonlLine(line)
    const transcriptEvents = events.filter((e) => e.type === "transcript")
    expect(transcriptEvents.length).toBeGreaterThan(0)
  })

  test("system.rate_limit subtype → rate_limit event", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "rate_limit",
      resetAt: 1748800000000,
      tz: "PT",
    })
    const events = parseJsonlLine(line)
    const rl = events.find((e) => e.type === "rate_limit")
    expect(rl).toBeDefined()
    expect(rl?.rateLimit?.tz).toBe("PT")
  })

  test("system.informational without rate-limit content → no rate_limit event", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "informational",
      content: "Remote Control failed to connect",
    })
    const events = parseJsonlLine(line)
    const rl = events.find((e) => e.type === "rate_limit")
    expect(rl).toBeUndefined()
  })
})

describe("createJsonlEventParser", () => {
  function emitTypes(events: HarnessEvent[]): string[] {
    return events.map((e) => e.type)
  }

  test("D3: emits session_token for every line carrying a session_id (not only system/init)", () => {
    const parser = createJsonlEventParser()
    const initLine = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "sess-A",
    })
    const assistantLine = JSON.stringify({
      type: "assistant",
      session_id: "sess-A",
      message: { id: "msg-1", role: "assistant", content: [{ type: "text", text: "hi" }] },
    })
    const initEvents = parser.parse(initLine)
    const assistantEvents = parser.parse(assistantLine)
    expect(initEvents.find((e) => e.type === "session_token")?.sessionToken).toBe("sess-A")
    expect(assistantEvents.find((e) => e.type === "session_token")?.sessionToken).toBe("sess-A")
  })

  test("D3: lines without session_id do not emit session_token", () => {
    const parser = createJsonlEventParser()
    const noSession = JSON.stringify({ type: "assistant", message: { role: "assistant", content: [] } })
    const events = parser.parse(noSession)
    expect(events.find((e) => e.type === "session_token")).toBeUndefined()
  })

  test("D2: SDK-native rate_limit_event message → rate_limit event via detector", () => {
    const parser = createJsonlEventParser()
    const line = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: {
        status: "rejected",
        // Epoch seconds (detector coerces to ms).
        resetsAt: 1_748_800_000,
      },
    })
    const events = parser.parse(line)
    const rl = events.find((e) => e.type === "rate_limit")
    expect(rl).toBeDefined()
    expect(rl?.rateLimit?.resetAt).toBe(1_748_800_000_000)
  })

  test("D2: rate_limit_event with status != rejected → no event", () => {
    const parser = createJsonlEventParser()
    const line = JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed", resetsAt: 1_748_800_000 },
    })
    const events = parser.parse(line)
    expect(events.find((e) => e.type === "rate_limit")).toBeUndefined()
  })

  test("D2: legacy system/rate_limit shape still recognised", () => {
    const parser = createJsonlEventParser()
    const line = JSON.stringify({
      type: "system",
      subtype: "rate_limit",
      resetAt: 1748800000000,
      tz: "PT",
    })
    const events = parser.parse(line)
    const rl = events.find((e) => e.type === "rate_limit")
    expect(rl).toBeDefined()
    expect(rl?.rateLimit?.tz).toBe("PT")
  })

  test("D1: assistant message with usage → context_window_updated transcript", () => {
    const parser = createJsonlEventParser()
    const line = JSON.stringify({
      type: "assistant",
      message: {
        id: "msg-usage-1",
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
      },
      usage: {
        input_tokens: 100,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 25,
      },
    })
    const events = parser.parse(line)
    const ctxEvents = events.filter(
      (e) => e.type === "transcript" && (e.entry as { kind?: string }).kind === "context_window_updated",
    )
    expect(ctxEvents).toHaveLength(1)
  })

  test("D1: duplicate assistant usage id is deduped", () => {
    const parser = createJsonlEventParser()
    const line = JSON.stringify({
      type: "assistant",
      message: {
        id: "msg-dedup",
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
      },
      usage: { input_tokens: 50, output_tokens: 10 },
    })
    const first = parser.parse(line)
    const second = parser.parse(line)
    const firstCtx = first.filter(
      (e) => e.type === "transcript" && (e.entry as { kind?: string }).kind === "context_window_updated",
    )
    const secondCtx = second.filter(
      (e) => e.type === "transcript" && (e.entry as { kind?: string }).kind === "context_window_updated",
    )
    expect(firstCtx).toHaveLength(1)
    expect(secondCtx).toHaveLength(0)
  })

  test("D1: result message after assistant emits final context_window_updated", () => {
    const parser = createJsonlEventParser()
    parser.parse(JSON.stringify({
      type: "assistant",
      message: { id: "msg-1", role: "assistant", content: [{ type: "text", text: "hi" }] },
      usage: { input_tokens: 80, output_tokens: 20 },
    }))
    const resultLine = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "done",
      isError: false,
      durationMs: 1000,
      usage: { input_tokens: 80, output_tokens: 20 },
      modelUsage: {
        "claude-sonnet-4-6": { contextWindow: 200000, inputTokens: 80, outputTokens: 20 },
      },
    })
    const events = parser.parse(resultLine)
    const ctxEvents = events.filter(
      (e) => e.type === "transcript" && (e.entry as { kind?: string }).kind === "context_window_updated",
    )
    expect(ctxEvents).toHaveLength(1)
  })

  test("D1: 1M context window floor preserved when modelUsage reports 200k", () => {
    const parser = createJsonlEventParser({ configuredContextWindow: 1_000_000 })
    parser.parse(JSON.stringify({
      type: "assistant",
      message: { id: "msg-1m", role: "assistant", content: [{ type: "text", text: "hi" }] },
      usage: { input_tokens: 100, output_tokens: 50 },
    }))
    const resultLine = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "done",
      isError: false,
      durationMs: 500,
      usage: { input_tokens: 100, output_tokens: 50 },
      modelUsage: { "claude-sonnet-4-6": { contextWindow: 200000 } },
    })
    const events = parser.parse(resultLine)
    const ctx = events.find(
      (e) => e.type === "transcript" && (e.entry as { kind?: string }).kind === "context_window_updated",
    )
    const usage = (ctx?.entry as { usage?: { maxTokens?: number } } | undefined)?.usage
    expect(usage?.maxTokens).toBe(1_000_000)
  })

  test("emitTypes helper produces deterministic order across calls", () => {
    const parser = createJsonlEventParser()
    const types = emitTypes(parser.parse(JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "sess-X",
    })))
    expect(types[0]).toBe("session_token")
  })

})
