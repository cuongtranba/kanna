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

  test("sidechain (subagent) line → no events", () => {
    const line = JSON.stringify({
      type: "assistant",
      isSidechain: true,
      session_id: "sub-sess",
      message: { role: "assistant", content: [{ type: "text", text: "subagent thinking" }] },
    })
    expect(parseJsonlLine(line)).toEqual([])
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

  // Real on-disk transcript lines use camelCase `sessionId`; only SDK
  // stream-json fixtures use snake_case `session_id`. The parser must accept
  // both, otherwise PTY chats never persist a session token and the fork
  // button stays disabled (canForkChat → false).
  test("D3: emits session_token for camelCase sessionId (real transcript shape)", () => {
    const parser = createJsonlEventParser()
    const realLine = JSON.stringify({
      type: "assistant",
      sessionId: "real-sess-1",
      message: { id: "msg-9", role: "assistant", content: [{ type: "text", text: "hi" }] },
    })
    const events = parser.parse(realLine)
    expect(events.find((e) => e.type === "session_token")?.sessionToken).toBe("real-sess-1")
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

  test("D1: on-disk transcript nests usage under message.usage → context_window_updated", () => {
    const parser = createJsonlEventParser()
    // Claude's on-disk transcript nests the Anthropic message (id, content AND
    // usage) under `.message`, unlike the SDK stream-json shape which keeps
    // `usage` at the top level. The parser must read the nested location or it
    // emits nothing for every real interactive session.
    const line = JSON.stringify({
      type: "assistant",
      message: {
        id: "msg-nested-1",
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
        usage: {
          input_tokens: 14334,
          cache_creation_input_tokens: 15367,
          cache_read_input_tokens: 17117,
          output_tokens: 435,
        },
      },
    })
    const events = parser.parse(line)
    const ctxEvents = events.filter(
      (e) => e.type === "transcript" && (e.entry as { kind?: string }).kind === "context_window_updated",
    )
    expect(ctxEvents).toHaveLength(1)
    const usage = (ctxEvents[0] as { entry: { usage: { usedTokens: number } } }).entry.usage
    expect(usage.usedTokens).toBe(14334 + 15367 + 17117 + 435)
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

  // A Task subagent writes its own messages into the parent transcript with
  // isSidechain:true. They must never reach the main turn stream: a sidechain
  // `result` (or its TUI `turn_duration` synth) would shift the parent's
  // pending prompt seq and finalize the user turn early (UI flips idle while
  // the main turn is still streaming); a sidechain session_id would clobber
  // the parent chat's claude session token.
  test("sidechain result → no transcript result entry and no session_token", () => {
    const parser = createJsonlEventParser()
    const line = JSON.stringify({
      type: "result",
      isSidechain: true,
      session_id: "sub-sess",
      subtype: "success",
      result: "subagent done",
      isError: false,
      duration_ms: 1000,
    })
    const events = parser.parse(line)
    expect(events).toEqual([])
  })

  test("sidechain turn_duration → no synthesized result entry", () => {
    const parser = createJsonlEventParser()
    const line = JSON.stringify({
      type: "system",
      subtype: "turn_duration",
      isSidechain: true,
      session_id: "sub-sess",
      durationMs: 1234,
    })
    const events = parser.parse(line)
    const resultEntries = events.filter(
      (e) => e.type === "transcript" && (e.entry as { kind?: string }).kind === "result",
    )
    expect(resultEntries).toEqual([])
    expect(events.find((e) => e.type === "session_token")).toBeUndefined()
  })

  test("non-sidechain turn_duration still synthesizes a result (regression guard)", () => {
    const parser = createJsonlEventParser()
    const line = JSON.stringify({
      type: "system",
      subtype: "turn_duration",
      session_id: "main-sess",
      durationMs: 1234,
    })
    const events = parser.parse(line)
    const resultEntries = events.filter(
      (e) => e.type === "transcript" && (e.entry as { kind?: string }).kind === "result",
    )
    expect(resultEntries).toHaveLength(1)
  })

  // Claude Code TUI's background task queue (`enqueuePendingNotification` +
  // `useQueueProcessor`) can auto-spawn a follow-up turn after `end_turn` when
  // a `run_in_background:true` bash exits. The wake injects a synthetic
  // `<task-notification>` user message with `isMeta:true` and runs another
  // model query. Kanna never sent a `chat_send` for this turn, so its
  // `result`/`turn_duration` must NOT consume a queued `pendingPromptSeq`
  // (which would steal a real user turn's seq) and must NOT alter Kanna's
  // turn lifecycle. Drop both the synthetic user line and the wake's final
  // result. Mid-turn `isMeta:true` injections (FileReadTool metadata, token
  // budget continuation) are distinguished by arriving AFTER an assistant
  // message in the same turn and must be left alone.
  describe("background auto-wake filtering", () => {
    function makeMetaUser(content: string): string {
      return JSON.stringify({
        type: "user",
        isMeta: true,
        message: { role: "user", content },
      })
    }
    function makeRealUser(text: string): string {
      return JSON.stringify({
        type: "user",
        message: { role: "user", content: text },
      })
    }
    function makeAssistant(text: string): string {
      return JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text }] },
      })
    }
    function makeResult(): string {
      return JSON.stringify({
        type: "result",
        subtype: "success",
        isError: false,
        duration_ms: 100,
        result: "",
      })
    }
    function makeTurnDuration(): string {
      return JSON.stringify({
        type: "system",
        subtype: "turn_duration",
        session_id: "main-sess",
        durationMs: 100,
      })
    }
    function resultEntries(events: HarnessEvent[]) {
      return events.filter(
        (e) => e.type === "transcript" && (e.entry as { kind?: string }).kind === "result",
      )
    }

    test("auto-wake: meta user at turn boundary → drop the synthetic user line", () => {
      const parser = createJsonlEventParser()
      // First a real turn ends, putting parser in between-turns state.
      parser.parse(makeRealUser("hi"))
      parser.parse(makeAssistant("hello"))
      parser.parse(makeResult())
      // Then a synthetic isMeta user arrives — the auto-wake.
      const events = parser.parse(makeMetaUser("<task-notification>bash done</task-notification>"))
      const userEntries = events.filter(
        (e) => e.type === "transcript" && (e.entry as { kind?: string }).kind === "user_prompt",
      )
      expect(userEntries).toEqual([])
    })

    test("auto-wake: result following meta user at turn boundary is dropped", () => {
      const parser = createJsonlEventParser()
      parser.parse(makeRealUser("hi"))
      parser.parse(makeAssistant("hello"))
      parser.parse(makeResult())
      parser.parse(makeMetaUser("<task-notification>bash done</task-notification>"))
      parser.parse(makeAssistant("acknowledged"))
      const events = parser.parse(makeResult())
      expect(resultEntries(events)).toEqual([])
    })

    test("auto-wake: turn_duration following meta user at turn boundary is dropped", () => {
      const parser = createJsonlEventParser()
      parser.parse(makeRealUser("hi"))
      parser.parse(makeAssistant("hello"))
      parser.parse(makeTurnDuration())
      parser.parse(makeMetaUser("<task-notification>bash done</task-notification>"))
      parser.parse(makeAssistant("acknowledged"))
      const events = parser.parse(makeTurnDuration())
      expect(resultEntries(events)).toEqual([])
    })

    test("mid-turn meta user (e.g. FileRead metadata) does NOT drop the next result", () => {
      const parser = createJsonlEventParser()
      parser.parse(makeRealUser("read a file"))
      parser.parse(makeAssistant("calling FileRead"))
      // Mid-turn isMeta injection — appears AFTER assistant.
      parser.parse(makeMetaUser("<file-metadata>...</file-metadata>"))
      parser.parse(makeAssistant("done"))
      const events = parser.parse(makeResult())
      // The real turn-end result must still be emitted.
      expect(resultEntries(events).length).toBeGreaterThan(0)
    })

    test("auto-wake chain: two consecutive wakes both dropped, real turn after still emits", () => {
      const parser = createJsonlEventParser()
      parser.parse(makeRealUser("hi"))
      parser.parse(makeAssistant("hello"))
      parser.parse(makeResult())
      // First wake.
      parser.parse(makeMetaUser("<task-notification>A done</task-notification>"))
      parser.parse(makeAssistant("ack A"))
      expect(resultEntries(parser.parse(makeResult()))).toEqual([])
      // Second wake immediately after.
      parser.parse(makeMetaUser("<task-notification>B done</task-notification>"))
      parser.parse(makeAssistant("ack B"))
      expect(resultEntries(parser.parse(makeResult()))).toEqual([])
      // Next REAL user prompt → its result must emit.
      parser.parse(makeRealUser("status?"))
      parser.parse(makeAssistant("all good"))
      expect(resultEntries(parser.parse(makeResult())).length).toBeGreaterThan(0)
    })

    test("auto-wake: assistant text inside a wake is still emitted (user sees model output)", () => {
      const parser = createJsonlEventParser()
      parser.parse(makeRealUser("hi"))
      parser.parse(makeAssistant("hello"))
      parser.parse(makeResult())
      parser.parse(makeMetaUser("<task-notification>bash done</task-notification>"))
      const events = parser.parse(makeAssistant("bash exited 0"))
      const transcript = events.filter((e) => e.type === "transcript")
      expect(transcript.length).toBeGreaterThan(0)
    })
  })

  // Claude CLI ≥ 2.1.x stopped writing `type:"system"` rows (turn_duration,
  // init, compact_boundary) into the on-disk transcript JSONL. The only
  // turn-end signal left is the final assistant message's
  // `message.stop_reason` ("end_turn" / "stop_sequence" / "max_tokens" /
  // "refusal" — NOT "tool_use", which means the turn continues). Each content
  // block of that final message is persisted as its own row, all carrying the
  // same id and stop_reason, followed by session-state checkpoint rows
  // (`last-prompt` / `ai-title` / `mode` / `permission-mode`). The parser must
  // synthesize exactly one `result` per turn, AFTER the final assistant row's
  // transcript entries, and must not double-emit when an old CLI still writes
  // `turn_duration` (or an SDK fixture writes `result`) right after.
  describe("stop_reason turn-end synthesis (claude ≥2.1.x, no system rows)", () => {
    function makeRealUser(text: string): string {
      return JSON.stringify({
        type: "user",
        sessionId: "sess-sr",
        message: { role: "user", content: text },
      })
    }
    function makeAssistantRow(args: {
      id: string
      stopReason: string | null
      block: Record<string, unknown>
    }): string {
      return JSON.stringify({
        type: "assistant",
        sessionId: "sess-sr",
        message: {
          id: args.id,
          role: "assistant",
          stop_reason: args.stopReason,
          content: [args.block],
        },
      })
    }
    function makeToolResultUser(toolUseId: string): string {
      return JSON.stringify({
        type: "user",
        sessionId: "sess-sr",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: toolUseId, content: "ok" }],
        },
      })
    }
    function makeLastPrompt(): string {
      return JSON.stringify({
        type: "last-prompt",
        lastPrompt: "hi",
        leafUuid: "leaf-1",
        sessionId: "sess-sr",
      })
    }
    function makeMetaUser(content: string): string {
      return JSON.stringify({
        type: "user",
        isMeta: true,
        sessionId: "sess-sr",
        message: { role: "user", content },
      })
    }
    function makeTurnDuration(): string {
      return JSON.stringify({
        type: "system",
        subtype: "turn_duration",
        sessionId: "sess-sr",
        durationMs: 1234,
      })
    }
    function resultEntries(events: HarnessEvent[]) {
      return events.filter(
        (e) => e.type === "transcript" && (e.entry as { kind?: string }).kind === "result",
      )
    }

    test("new-format turn: result synthesized once, flushed on the checkpoint row", () => {
      const parser = createJsonlEventParser()
      expect(resultEntries(parser.parse(makeRealUser("list files")))).toEqual([])
      expect(resultEntries(parser.parse(makeAssistantRow({
        id: "msg_tool",
        stopReason: "tool_use",
        block: { type: "tool_use", id: "tu_1", name: "Glob", input: { pattern: "*" } },
      })))).toEqual([])
      expect(resultEntries(parser.parse(makeToolResultUser("tu_1")))).toEqual([])
      // Final message: thinking row + text row, both stop_reason end_turn.
      expect(resultEntries(parser.parse(makeAssistantRow({
        id: "msg_end",
        stopReason: "end_turn",
        block: { type: "thinking", thinking: "done thinking" },
      })))).toEqual([])
      expect(resultEntries(parser.parse(makeAssistantRow({
        id: "msg_end",
        stopReason: "end_turn",
        block: { type: "text", text: "all done" },
      })))).toEqual([])
      // Checkpoint row arrives → the pending turn-end flushes here.
      const flushed = parser.parse(makeLastPrompt())
      expect(resultEntries(flushed)).toHaveLength(1)
      const entry = resultEntries(flushed)[0]?.entry as { subtype?: string; isError?: boolean }
      expect(entry.subtype).toBe("success")
      expect(entry.isError).toBe(false)
    })

    test("tool_use stop_reason never synthesizes a result", () => {
      const parser = createJsonlEventParser()
      parser.parse(makeRealUser("hi"))
      parser.parse(makeAssistantRow({
        id: "msg_t",
        stopReason: "tool_use",
        block: { type: "tool_use", id: "tu_2", name: "Read", input: {} },
      }))
      expect(resultEntries(parser.parse(makeLastPrompt()))).toEqual([])
    })

    test("old format: turn_duration after end_turn rows emits exactly one result (the real one)", () => {
      const parser = createJsonlEventParser()
      parser.parse(makeRealUser("hi"))
      parser.parse(makeAssistantRow({
        id: "msg_old",
        stopReason: "end_turn",
        block: { type: "text", text: "hello" },
      }))
      const events = parser.parse(makeTurnDuration())
      const results = resultEntries(events)
      expect(results).toHaveLength(1)
      expect((results[0]?.entry as { durationMs?: number }).durationMs).toBe(1234)
      // Nothing pending afterwards — checkpoint row emits no second result.
      expect(resultEntries(parser.parse(makeLastPrompt()))).toEqual([])
    })

    test("SDK shape: result row directly after end_turn rows emits exactly one result", () => {
      const parser = createJsonlEventParser()
      parser.parse(makeRealUser("hi"))
      parser.parse(makeAssistantRow({
        id: "msg_sdk",
        stopReason: "end_turn",
        block: { type: "text", text: "hello" },
      }))
      const events = parser.parse(JSON.stringify({
        type: "result",
        subtype: "success",
        isError: false,
        duration_ms: 777,
        result: "hello",
      }))
      const results = resultEntries(events)
      expect(results).toHaveLength(1)
      expect((results[0]?.entry as { durationMs?: number }).durationMs).toBe(777)
    })

    test("late turn_duration after a synthesized flush is swallowed; next turn unaffected", () => {
      const parser = createJsonlEventParser()
      parser.parse(makeRealUser("hi"))
      parser.parse(makeAssistantRow({
        id: "msg_a",
        stopReason: "end_turn",
        block: { type: "text", text: "first" },
      }))
      expect(resultEntries(parser.parse(makeLastPrompt()))).toHaveLength(1)
      // An old CLI writing turn_duration after the checkpoint must not
      // double-finalize the turn.
      expect(resultEntries(parser.parse(makeTurnDuration()))).toEqual([])
      // Next real turn still produces its own result.
      parser.parse(makeRealUser("again"))
      parser.parse(makeAssistantRow({
        id: "msg_b",
        stopReason: "end_turn",
        block: { type: "text", text: "second" },
      }))
      expect(resultEntries(parser.parse(makeLastPrompt()))).toHaveLength(1)
    })

    test("auto-wake under new format: wake turn's synthesized result is dropped", () => {
      const parser = createJsonlEventParser()
      // Real turn 1 ends via stop_reason flush → parser is between turns.
      parser.parse(makeRealUser("hi"))
      parser.parse(makeAssistantRow({
        id: "msg_1",
        stopReason: "end_turn",
        block: { type: "text", text: "hello" },
      }))
      expect(resultEntries(parser.parse(makeLastPrompt()))).toHaveLength(1)
      // Background auto-wake at the boundary.
      const wakeEvents = parser.parse(makeMetaUser("<task-notification>bash done</task-notification>"))
      expect(wakeEvents.filter(
        (e) => e.type === "transcript" && (e.entry as { kind?: string }).kind === "user_prompt",
      )).toEqual([])
      parser.parse(makeAssistantRow({
        id: "msg_wake",
        stopReason: "end_turn",
        block: { type: "text", text: "ack" },
      }))
      // The wake turn's flush must be swallowed.
      expect(resultEntries(parser.parse(makeLastPrompt()))).toEqual([])
      // Next REAL turn emits again.
      parser.parse(makeRealUser("status?"))
      parser.parse(makeAssistantRow({
        id: "msg_2",
        stopReason: "end_turn",
        block: { type: "text", text: "fine" },
      }))
      expect(resultEntries(parser.parse(makeLastPrompt()))).toHaveLength(1)
    })

    test("keep-alive channel push under new format: its turn-end result emits", () => {
      const parser = createJsonlEventParser()
      parser.parse(JSON.stringify({
        type: "user",
        isMeta: true,
        sessionId: "sess-sr",
        message: { role: "user", content: '<channel source="kanna">do the task</channel>' },
      }))
      parser.parse(makeAssistantRow({
        id: "msg_ch",
        stopReason: "end_turn",
        block: { type: "text", text: "DONE" },
      }))
      expect(resultEntries(parser.parse(makeLastPrompt()))).toHaveLength(1)
    })

    test("synthesized result carries usage from the final assistant message (CLI ≥2.1.x path)", () => {
      const parser = createJsonlEventParser()
      parser.parse(makeRealUser("list files"))
      // Final assistant row with terminal stop_reason and usage nested under message.usage
      // (the real on-disk transcript shape).
      const assistantWithUsage = JSON.stringify({
        type: "assistant",
        sessionId: "sess-sr",
        message: {
          id: "msg_usage_flush",
          role: "assistant",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "here are the files" }],
          usage: {
            input_tokens: 1234,
            cache_creation_input_tokens: 100,
            cache_read_input_tokens: 50,
            output_tokens: 42,
          },
        },
      })
      parser.parse(assistantWithUsage)
      // Checkpoint row triggers the pending flush.
      const flushed = parser.parse(makeLastPrompt())
      const results = resultEntries(flushed)
      expect(results).toHaveLength(1)
      const entry = results[0]?.entry as {
        kind?: string
        subtype?: string
        usage?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number }
      }
      expect(entry.subtype).toBe("success")
      // normalizeClaudeUsageSnapshot sums direct + cache_creation + cache_read into inputTokens
      // (1234 + 100 + 50 = 1384). cachedInputTokens = cache_read only (50).
      expect(entry.usage?.inputTokens).toBe(1384)
      expect(entry.usage?.outputTokens).toBe(42)
      expect(entry.usage?.cachedInputTokens).toBe(50)
    })

    test("synthesized result resets usage tracking; next turn starts clean", () => {
      const parser = createJsonlEventParser()
      // Turn 1: assistant with usage → synthesized result.
      parser.parse(makeRealUser("turn 1"))
      const assistantRow = JSON.stringify({
        type: "assistant",
        sessionId: "sess-sr",
        message: {
          id: "msg_t1",
          role: "assistant",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "done" }],
          usage: {
            input_tokens: 99,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 11,
          },
        },
      })
      parser.parse(assistantRow)
      const turn1Results = resultEntries(parser.parse(makeLastPrompt()))
      expect(turn1Results).toHaveLength(1)
      const t1Entry = turn1Results[0]?.entry as { usage?: { inputTokens?: number } }
      expect(t1Entry.usage?.inputTokens).toBe(99)

      // Turn 2: assistant with no usage — synthesized result should have no usage field.
      parser.parse(makeRealUser("turn 2"))
      const assistantNoUsage = JSON.stringify({
        type: "assistant",
        sessionId: "sess-sr",
        message: {
          id: "msg_t2",
          role: "assistant",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "also done" }],
          // No usage field at all.
        },
      })
      parser.parse(assistantNoUsage)
      const turn2Results = resultEntries(parser.parse(makeLastPrompt()))
      expect(turn2Results).toHaveLength(1)
      const t2Entry = turn2Results[0]?.entry as { usage?: unknown }
      expect(t2Entry.usage).toBeUndefined()
    })

    test("sidechain row still triggers the pending flush (result not delayed)", () => {
      const parser = createJsonlEventParser()
      parser.parse(makeRealUser("hi"))
      parser.parse(makeAssistantRow({
        id: "msg_main",
        stopReason: "end_turn",
        block: { type: "text", text: "spawned a subagent earlier" },
      }))
      const events = parser.parse(JSON.stringify({
        type: "assistant",
        isSidechain: true,
        sessionId: "sub-sess",
        message: { id: "msg_side", role: "assistant", content: [{ type: "text", text: "side" }] },
      }))
      expect(resultEntries(events)).toHaveLength(1)
    })
  })

  // Keep-alive multi-turn subagents deliver EVERY turn (including turn 1) via a
  // kanna channel push, which lands in the transcript as a `user isMeta:true`
  // line whose content carries the `<channel source="kanna">` tag. Those lines
  // arrive at a turn boundary (turnState === "between") and would be
  // misclassified as background auto-wakes by the filter above, dropping the
  // synthesized turn-end result and hanging `drainOneTurn` forever. A kanna
  // channel push IS a real turn the main agent issued, so it must be exempted —
  // genuine `<task-notification>` auto-wakes (no kanna tag) stay filtered.
  describe("keep-alive channel-push exemption", () => {
    function makeChannelUser(content: string): string {
      return JSON.stringify({
        type: "user",
        isMeta: true,
        message: { role: "user", content },
      })
    }
    function makeChannelUserBlocks(text: string): string {
      return JSON.stringify({
        type: "user",
        isMeta: true,
        message: { role: "user", content: [{ type: "text", text }] },
      })
    }
    function makeAssistant(text: string): string {
      return JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text }] },
      })
    }
    function makeMetaUser(content: string): string {
      return JSON.stringify({
        type: "user",
        isMeta: true,
        message: { role: "user", content },
      })
    }
    function makeTurnDuration(): string {
      return JSON.stringify({
        type: "system",
        subtype: "turn_duration",
        session_id: "main-sess",
        durationMs: 100,
      })
    }
    function resultEntries(events: HarnessEvent[]) {
      return events.filter(
        (e) => e.type === "transcript" && (e.entry as { kind?: string }).kind === "result",
      )
    }

    test("turn 1: channel push at boundary is NOT an auto-wake — its result emits", () => {
      const parser = createJsonlEventParser()
      // Keep-alive turn 1 opens at the between-turns boundary via channel push.
      parser.parse(makeChannelUser('<channel source="kanna">do the task</channel>'))
      parser.parse(makeAssistant("DONE"))
      const events = parser.parse(makeTurnDuration())
      expect(resultEntries(events).length).toBeGreaterThan(0)
    })

    test("turn 2: a second channel push after turn 1 also emits its result", () => {
      const parser = createJsonlEventParser()
      parser.parse(makeChannelUser('<channel source="kanna">turn one</channel>'))
      parser.parse(makeAssistant("DONE A"))
      expect(resultEntries(parser.parse(makeTurnDuration())).length).toBeGreaterThan(0)
      // Follow-up turn — another channel push at the new boundary.
      parser.parse(makeChannelUser('<channel source="kanna">turn two</channel>'))
      parser.parse(makeAssistant("DONE B"))
      expect(resultEntries(parser.parse(makeTurnDuration())).length).toBeGreaterThan(0)
    })

    test("channel push with array content blocks is also exempted", () => {
      const parser = createJsonlEventParser()
      parser.parse(makeChannelUserBlocks('<channel source="kanna">block form</channel>'))
      parser.parse(makeAssistant("DONE"))
      expect(resultEntries(parser.parse(makeTurnDuration())).length).toBeGreaterThan(0)
    })

    test("regression: a genuine task-notification wake after a channel turn is still dropped", () => {
      const parser = createJsonlEventParser()
      // Real channel-push turn.
      parser.parse(makeChannelUser('<channel source="kanna">turn one</channel>'))
      parser.parse(makeAssistant("DONE"))
      expect(resultEntries(parser.parse(makeTurnDuration())).length).toBeGreaterThan(0)
      // Claude Code's own background auto-wake (no kanna tag) must stay filtered.
      parser.parse(makeMetaUser("<task-notification>bash done</task-notification>"))
      parser.parse(makeAssistant("ack"))
      expect(resultEntries(parser.parse(makeTurnDuration()))).toEqual([])
    })
  })

  describe("nested_memory → memory_loaded", () => {
    const memoryPaths = (events: HarnessEvent[]): string[] =>
      events
        .filter((e) => e.type === "transcript")
        .map((e) => e.entry)
        .filter((entry) => entry?.kind === "memory_loaded")
        .map((entry) => (entry as { path: string }).path)

    const resultCount = (events: HarnessEvent[]): number =>
      events.filter((e) => e.type === "transcript" && e.entry?.kind === "result").length

    const nestedMemory = (path: unknown): string =>
      JSON.stringify({ type: "nested_memory", attachment: { type: "nested_memory", path } })

    test("emits one memory_loaded entry carrying the attachment path", () => {
      const parser = createJsonlEventParser()
      const paths = memoryPaths(parser.parse(nestedMemory("/repo/.claude/rules/pattern_id.md")))
      expect(paths).toEqual(["/repo/.claude/rules/pattern_id.md"])
    })

    test("malformed nested_memory (missing/blank/non-string path) emits nothing, does not throw", () => {
      const parser = createJsonlEventParser()
      expect(memoryPaths(parser.parse(JSON.stringify({ type: "nested_memory" })))).toEqual([])
      expect(memoryPaths(parser.parse(nestedMemory("")))).toEqual([])
      expect(memoryPaths(parser.parse(nestedMemory(42)))).toEqual([])
    })

    test("does not disturb turn-state (mid-turn nested_memory keeps the result emitting)", () => {
      const parser = createJsonlEventParser()
      parser.parse(JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }))
      parser.parse(nestedMemory("/repo/CLAUDE.md"))
      parser.parse(JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "answer" }] } }))
      const resultLine = JSON.stringify({ type: "system", subtype: "turn_duration", duration_ms: 5 })
      expect(resultCount(parser.parse(resultLine))).toBeGreaterThan(0)
    })
  })
})
