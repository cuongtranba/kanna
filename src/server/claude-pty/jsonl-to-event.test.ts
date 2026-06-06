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
