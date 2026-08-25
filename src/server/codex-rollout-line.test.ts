import { describe, test, expect } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  classifyRolloutLine,
  classifyRolloutLineOutcome,
  isSubagentSessionMeta,
  isSyntheticUserText,
} from "./codex-rollout-line"
import type { CodexRolloutRecord } from "./codex-session-types"
import {
  writeCodexRolloutFixture,
  writeSubagentRollout,
} from "./__fixtures__/codex-rollout-fixture"

const FALLBACK = Date.parse("2020-01-01T00:00:00.000Z")

function classify(line: object, lineIndex = 0): CodexRolloutRecord | null {
  return classifyRolloutLine(JSON.stringify(line), lineIndex, FALLBACK)
}

function envelope(type: string, payload: object) {
  return { timestamp: "2026-06-07T06:00:00.000Z", type, payload }
}

/** Classify a whole file the way a parser must: advance the index on EVERY line. */
function classifyFile(path: string): { records: CodexRolloutRecord[]; lineCount: number } {
  const lines = readFileSync(path, "utf8").split("\n")
  const records: CodexRolloutRecord[] = []
  lines.forEach((line, lineIndex) => {
    const record = classifyRolloutLine(line, lineIndex, FALLBACK)
    if (record) records.push(record)
  })
  return { records, lineCount: lines.length }
}

describe("classifyRolloutLine — envelope handling", () => {
  test("blank lines return null but do not consume an index", () => {
    expect(classifyRolloutLine("", 3, FALLBACK)).toBeNull()
    expect(classifyRolloutLine("   \t ", 4, FALLBACK)).toBeNull()
  })

  test("unparseable JSON returns null", () => {
    expect(classifyRolloutLine("{not json", 0, FALLBACK)).toBeNull()
    expect(classifyRolloutLine("null", 0, FALLBACK)).toBeNull()
    expect(classifyRolloutLine("[1,2,3]", 0, FALLBACK)).toBeNull()
  })

  test("lineIndex is the PHYSICAL line, so blanks and drops still advance it", () => {
    const raw = [
      JSON.stringify(envelope("session_meta", { id: "s1", cwd: "/tmp" })),
      "",
      JSON.stringify(envelope("world_state", { snapshot: {} })),
      "   ",
      JSON.stringify(envelope("response_item", {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "hi" }],
      })),
    ]
    const kept: CodexRolloutRecord[] = []
    raw.forEach((line, lineIndex) => {
      const record = classifyRolloutLine(line, lineIndex, FALLBACK)
      if (record) kept.push(record)
    })
    expect(kept.map((r) => r.lineIndex)).toEqual([0, 4])
  })

  test("both envelope shapes classify identically; `ordinal` is never read", () => {
    const payload = {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "same" }],
    }
    const bare = classify({ timestamp: "2026-06-07T06:00:00.000Z", type: "response_item", payload })
    const withOrdinal = classify({
      ordinal: 42,
      timestamp: "2026-06-07T06:00:00.000Z",
      type: "response_item",
      payload,
    })
    expect(bare).toEqual(withOrdinal)
  })

  test("timestamp falls back when absent or unparseable", () => {
    const record = classify({ type: "compacted", payload: {} })
    expect(record?.timestamp).toBe(FALLBACK)
    const bad = classify({ timestamp: "not-a-date", type: "compacted", payload: {} })
    expect(bad?.timestamp).toBe(FALLBACK)
    const good = classify(envelope("compacted", {}))
    expect(good?.timestamp).toBe(Date.parse("2026-06-07T06:00:00.000Z"))
  })
})

describe("classifyRolloutLine — dropped types", () => {
  const droppedTopLevel = ["world_state", "inter_agent_communication_metadata", "future_thing"]
  for (const type of droppedTopLevel) {
    test(`drops top-level ${type}`, () => {
      expect(classify(envelope(type, { anything: true }))).toBeNull()
    })
  }

  const droppedEventMsg = [
    "item_completed",
    "context_compacted",
    "task_started",
    "user_message",
    "agent_message",
    "patch_apply_end",
    "sub_agent_activity",
    "web_search_end",
  ]
  for (const type of droppedEventMsg) {
    test(`drops event_msg/${type}`, () => {
      expect(classify(envelope("event_msg", { type, payload: {} }))).toBeNull()
    })
  }

  const droppedResponseItem = [
    "agent_message",
    "tool_search_call",
    "tool_search_output",
    "image_generation_call",
  ]
  for (const type of droppedResponseItem) {
    test(`drops response_item/${type}`, () => {
      expect(classify(envelope("response_item", { type, id: "x" }))).toBeNull()
    })
  }

  test("event_msg/item_completed is ignored even when it carries a full item", () => {
    const record = classify(envelope("event_msg", {
      type: "item_completed",
      item: { id: "i1", item_type: "command_execution", command: "ls" },
    }))
    expect(record).toBeNull()
  })
})

describe("classifyRolloutLine — messages", () => {
  for (const prefix of [
    "<environment_context>\n  <cwd>/tmp</cwd>\n</environment_context>",
    "<user_instructions>\ndo the thing\n</user_instructions>",
    "<recommended_plugins>\nHere is a list\n</recommended_plugins>",
    "# AGENTS.md instructions for /tmp/project\n\nbe terse",
    "# AGENTS.md instructions\n\n<INSTRUCTIONS>be terse</INSTRUCTIONS>",
  ]) {
    test(`drops synthetic first user message: ${prefix.slice(0, 28)}`, () => {
      expect(isSyntheticUserText(prefix)).toBe(true)
      const record = classify(envelope("response_item", {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: prefix }],
      }))
      expect(record).toBeNull()
    })
  }

  test("a real human user message survives", () => {
    const record = classify(envelope("response_item", {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "work on main but don't push" }],
    }))
    expect(record).toEqual({
      kind: "user_message",
      lineIndex: 0,
      timestamp: Date.parse("2026-06-07T06:00:00.000Z"),
      text: "work on main but don't push",
    })
  })

  test("a message merely MENTIONING a synthetic prefix mid-text survives", () => {
    const record = classify(envelope("response_item", {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "why does <environment_context> appear?" }],
    }))
    expect(record?.kind).toBe("user_message")
  })

  test("drops developer-role messages", () => {
    const record = classify(envelope("response_item", {
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: "# Skill preamble" }],
    }))
    expect(record).toBeNull()
  })

  test("assistant messages join multi-part output_text", () => {
    const record = classify(envelope("response_item", {
      type: "message",
      role: "assistant",
      content: [
        { type: "output_text", text: "part one " },
        { type: "output_text", text: "part two" },
      ],
    }))
    expect(record).toMatchObject({ kind: "assistant_message", text: "part one part two" })
  })

  test("drops an empty-content message", () => {
    expect(classify(envelope("response_item", {
      type: "message",
      role: "assistant",
      content: [],
    }))).toBeNull()
  })
})

describe("classifyRolloutLine — tools", () => {
  test("custom_tool_call becomes family custom with the raw input", () => {
    const record = classify(envelope("response_item", {
      type: "custom_tool_call",
      status: "completed",
      call_id: "call_1",
      name: "exec",
      input: "const r = await tools.exec_command({ cmd: \"ls\" });",
    }))
    expect(record).toMatchObject({
      kind: "tool_call",
      callId: "call_1",
      name: "exec",
      family: "custom",
      input: "const r = await tools.exec_command({ cmd: \"ls\" });",
    })
  })

  test("function_call becomes family function with the raw arguments STRING", () => {
    const record = classify(envelope("response_item", {
      type: "function_call",
      name: "exec_command",
      call_id: "call_2",
      arguments: "{\"cmd\":\"pwd\"}",
    }))
    expect(record).toMatchObject({
      kind: "tool_call",
      callId: "call_2",
      name: "exec_command",
      family: "function",
      input: "{\"cmd\":\"pwd\"}",
    })
  })

  test("a call with no call_id is dropped rather than given a synthetic key", () => {
    expect(classify(envelope("response_item", {
      type: "function_call",
      name: "exec_command",
      arguments: "{}",
    }))).toBeNull()
  })

  test("output as a STRING flattens", () => {
    const record = classify(envelope("response_item", {
      type: "function_call_output",
      call_id: "call_2",
      output: "exit 0\n",
    }))
    expect(record).toMatchObject({ kind: "tool_output", callId: "call_2", output: "exit 0\n" })
  })

  test("output as an ARRAY of input_text parts flattens to the same shape", () => {
    const record = classify(envelope("response_item", {
      type: "custom_tool_call_output",
      call_id: "call_3",
      output: [
        { type: "input_text", text: "first\n" },
        { type: "input_text", text: "second\n" },
      ],
    }))
    expect(record).toMatchObject({
      kind: "tool_output",
      callId: "call_3",
      output: "first\nsecond\n",
    })
  })

  test("an output of an unexpected shape flattens to empty, never throws", () => {
    const record = classify(envelope("response_item", {
      type: "custom_tool_call_output",
      call_id: "call_4",
      output: { unexpected: true },
    }))
    expect(record).toMatchObject({ kind: "tool_output", output: "" })
  })

  test("web_search_call takes its query from action, since there is no top-level one", () => {
    expect(classify(envelope("response_item", {
      type: "web_search_call",
      status: "completed",
      action: { type: "search", query: "site:example.com foo", queries: ["site:example.com foo"] },
    }))).toMatchObject({ kind: "web_search", query: "site:example.com foo" })

    expect(classify(envelope("response_item", {
      type: "web_search_call",
      status: "completed",
      action: { type: "search", queries: ["only in queries"] },
    }))).toMatchObject({ kind: "web_search", query: "only in queries" })

    // open_page carries no query at all — the corpus's most common shape
    expect(classify(envelope("response_item", {
      type: "web_search_call",
      status: "completed",
      action: { type: "open_page", url: "https://example.com" },
    }))).toMatchObject({ kind: "web_search", query: "" })

    expect(classify(envelope("response_item", {
      type: "web_search_call",
      status: "completed",
    }))).toMatchObject({ kind: "web_search", query: "" })
  })
})

describe("classifyRolloutLine — reasoning never reads encrypted_content", () => {
  test("keeps only the plain summary", () => {
    const record = classify(envelope("response_item", {
      type: "reasoning",
      summary: [],
      encrypted_content: "gAAAAABqJQjvCZ1ttREur1XOPW4bnuvo",
    }))
    expect(record).toEqual({
      kind: "reasoning",
      lineIndex: 0,
      timestamp: Date.parse("2026-06-07T06:00:00.000Z"),
      summary: [],
    })
    expect(JSON.stringify(record)).not.toContain("gAAAAAB")
  })

  test("a populated summary is carried through", () => {
    const record = classify(envelope("response_item", {
      type: "reasoning",
      summary: ["thinking about it", 7, "and more"],
      encrypted_content: "blob",
    }))
    expect(record).toMatchObject({ summary: ["thinking about it", "and more"] })
  })
})

describe("classifyRolloutLine — token_count", () => {
  test("info: null is CARRIED, not dropped", () => {
    const record = classify(envelope("event_msg", {
      type: "token_count",
      info: null,
      rate_limits: { limit_id: "codex" },
    }))
    expect(record).toEqual({
      kind: "token_count",
      lineIndex: 0,
      timestamp: Date.parse("2026-06-07T06:00:00.000Z"),
      info: null,
    })
  })

  test("snake_case counters are read into the app-server-shaped info", () => {
    const record = classify(envelope("event_msg", {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: 13369,
          cached_input_tokens: 2432,
          output_tokens: 11,
          reasoning_output_tokens: 0,
          total_tokens: 13380,
          cache_write_input_tokens: 5,
        },
        last_token_usage: { input_tokens: 1, total_tokens: 2 },
        model_context_window: 258400,
      },
    }))
    expect(record).toMatchObject({
      kind: "token_count",
      info: {
        total_token_usage: {
          input_tokens: 13369,
          cached_input_tokens: 2432,
          output_tokens: 11,
          reasoning_output_tokens: 0,
          total_tokens: 13380,
        },
        last_token_usage: { input_tokens: 1, total_tokens: 2 },
        model_context_window: 258400,
      },
    })
  })
})

describe("classifyRolloutLine — turn terminals and model hints", () => {
  test("task_complete becomes turn_complete", () => {
    expect(classify(envelope("event_msg", {
      type: "task_complete",
      turn_id: "t1",
      last_agent_message: "Hello. How can I help?",
      duration_ms: 2899,
    }))).toMatchObject({
      kind: "turn_complete",
      lastAgentMessage: "Hello. How can I help?",
      durationMs: 2899,
    })
  })

  test("turn_aborted keeps its reason", () => {
    expect(classify(envelope("event_msg", {
      type: "turn_aborted",
      reason: "interrupted",
      duration_ms: 8530,
    }))).toMatchObject({ kind: "turn_aborted", reason: "interrupted", durationMs: 8530 })
  })

  test("turn_context carries the model directly on the payload", () => {
    expect(classify(envelope("turn_context", {
      cwd: "/tmp",
      model: "gpt-5.6-sol",
      approval_policy: "never",
    }))).toMatchObject({ kind: "model_hint", model: "gpt-5.6-sol" })
  })

  test("thread_settings_applied nests the model under thread_settings", () => {
    expect(classify(envelope("event_msg", {
      type: "thread_settings_applied",
      thread_settings: { model: "gpt-5.6-sol", model_provider_id: "cliproxyapi" },
    }))).toMatchObject({ kind: "model_hint", model: "gpt-5.6-sol" })
  })

  test("a model hint with nothing readable is still a hint, with a null model", () => {
    expect(classify(envelope("turn_context", { cwd: "/tmp" })))
      .toMatchObject({ kind: "model_hint", model: null })
    expect(classify(envelope("event_msg", { type: "thread_settings_applied" })))
      .toMatchObject({ kind: "model_hint", model: null })
  })
})

describe("classifyRolloutLine — compacted carries the summary and NOTHING else", () => {
  // `payload.message` is a short human-readable summary and is present on
  // 230 of 230 `compacted` records in the reference corpus. Dropping it left
  // imported sessions showing a bare boundary where a live codex `/compact`
  // renders boundary + summary.
  test("payload.message becomes the summary", () => {
    const record = classify(envelope("compacted", {
      window_id: "w2",
      message: "Summary of the conversation so far.",
    }))
    expect(record).toEqual({
      kind: "compacted",
      lineIndex: 0,
      timestamp: Date.parse("2026-06-07T06:00:00.000Z"),
      summary: "Summary of the conversation so far.",
    })
  })

  test("replacement_history stays structurally unreachable", () => {
    const record = classify(envelope("compacted", {
      window_id: "w2",
      message: "Summary of the conversation so far.",
      replacement_history: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "replay one" }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "replay two" }] },
      ],
    }))
    expect(record).toEqual({
      kind: "compacted",
      lineIndex: 0,
      timestamp: Date.parse("2026-06-07T06:00:00.000Z"),
      summary: "Summary of the conversation so far.",
    })
    const serialized = JSON.stringify(record)
    expect(serialized).not.toContain("replay one")
    expect(serialized).not.toContain("replay two")
    expect(serialized).not.toContain("replacement_history")
  })

  for (const [label, payload] of [
    ["absent", { window_id: "w2" }],
    ["empty", { window_id: "w2", message: "" }],
    ["blank", { window_id: "w2", message: "   \n " }],
    ["not a string", { window_id: "w2", message: { text: "nope" } }],
  ] as const) {
    test(`a ${label} message reads as no summary`, () => {
      expect(classify(envelope("compacted", payload)))
        .toMatchObject({ kind: "compacted", summary: null })
    })
  }

  test("a compacted line with no payload object at all is still a boundary", () => {
    expect(classifyRolloutLine(
      JSON.stringify({ timestamp: "2026-06-07T06:00:00.000Z", type: "compacted" }),
      0,
      FALLBACK,
    )).toMatchObject({ kind: "compacted", summary: null })
  })
})

describe("session_meta + subagent refusal", () => {
  test("session_meta reads id, cwd, cli_version and the three markers", () => {
    const record = classify(envelope("session_meta", {
      id: "sess-1",
      cwd: "/tmp/demo",
      cli_version: "0.58.0",
      model_provider: "cliproxyapi",
    }))
    expect(record).toMatchObject({
      kind: "session_meta",
      meta: {
        sessionId: "sess-1",
        cwd: "/tmp/demo",
        cliVersion: "0.58.0",
        parentThreadId: null,
        forkedFromId: null,
        agentPath: null,
      },
    })
  })

  test("model_provider is NOT a model name and never becomes one", () => {
    const record = classify(envelope("session_meta", {
      id: "sess-1",
      cwd: "/tmp",
      model_provider: "cliproxyapi",
    }))
    expect(JSON.stringify(record)).not.toContain("cliproxyapi")
  })

  test("a marker present-but-null is NOT a subagent", () => {
    const record = classify(envelope("session_meta", {
      id: "s",
      cwd: "/tmp",
      parent_thread_id: null,
      forked_from_id: null,
      agent_path: null,
    }))
    expect(record?.kind).toBe("session_meta")
    if (record?.kind !== "session_meta") throw new Error("expected session_meta")
    expect(isSubagentSessionMeta(record.meta)).toBe(false)
  })

  for (const marker of ["parent_thread_id", "forked_from_id", "agent_path"]) {
    test(`a non-null ${marker} makes it a subagent rollout`, () => {
      const record = classify(envelope("session_meta", {
        id: "s",
        cwd: "/tmp",
        [marker]: "non-null",
      }))
      if (record?.kind !== "session_meta") throw new Error("expected session_meta")
      expect(isSubagentSessionMeta(record.meta)).toBe(true)
    })
  }
})

describe("classifyRolloutLineOutcome — WHY a line produced nothing", () => {
  function outcome(line: string) {
    return classifyRolloutLineOutcome(line, 0, FALLBACK)
  }
  function outcomeOf(line: object) {
    return outcome(JSON.stringify(line))
  }

  test("a blank line is `blank`, never confused with damage", () => {
    expect(outcome("")).toEqual({ kind: "skipped", reason: "blank" })
    expect(outcome("   \t ")).toEqual({ kind: "skipped", reason: "blank" })
    expect(outcome("\n")).toEqual({ kind: "skipped", reason: "blank" })
  })

  // THE distinction this export exists for: a half-written or disk-corrupted
  // rollout must not read as an intentional drop, or the operator gets a
  // transcript missing turns and a green "imported".
  for (const [label, line] of [
    ["truncated JSON", "{\"type\":\"response_item\",\"pay"],
    ["not JSON at all", " garbage"],
    ["a JSON null", "null"],
    ["a JSON array", "[1,2,3]"],
    ["a JSON scalar", "\"just a string\""],
  ] as const) {
    test(`${label} is \`unparseable\``, () => {
      expect(outcome(line)).toEqual({ kind: "skipped", reason: "unparseable" })
    })
  }

  test("a recognized envelope whose payload is not an object is `unparseable`", () => {
    expect(outcomeOf({ type: "response_item", payload: "oops" }))
      .toEqual({ kind: "skipped", reason: "unparseable" })
    expect(outcomeOf({ type: "event_msg" }))
      .toEqual({ kind: "skipped", reason: "unparseable" })
    expect(outcomeOf({ type: "turn_context", payload: null }))
      .toEqual({ kind: "skipped", reason: "unparseable" })
  })

  test("a retained type missing a REQUIRED field is `unparseable`", () => {
    expect(outcomeOf(envelope("session_meta", { id: "s1" })))
      .toEqual({ kind: "skipped", reason: "unparseable" })
    expect(outcomeOf(envelope("session_meta", { cwd: "/tmp" })))
      .toEqual({ kind: "skipped", reason: "unparseable" })
    expect(outcomeOf(envelope("response_item", {
      type: "function_call",
      name: "exec_command",
      arguments: "{}",
    }))).toEqual({ kind: "skipped", reason: "unparseable" })
    expect(outcomeOf(envelope("response_item", {
      type: "function_call_output",
      output: "exit 0",
    }))).toEqual({ kind: "skipped", reason: "unparseable" })
  })

  // Read fine and complete; Kanna simply does not import them.
  for (const [label, line] of [
    ["an unknown top-level type", envelope("world_state", { snapshot: {} })],
    ["a future top-level type", envelope("inter_agent_communication_metadata", {})],
    ["an unretained event_msg", envelope("event_msg", { type: "item_completed", item: {} })],
    ["an unretained response_item", envelope("response_item", { type: "tool_search_call" })],
    ["a developer-role message", envelope("response_item", {
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: "# Skill preamble" }],
    })],
    ["a synthetic user preamble", envelope("response_item", {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "<environment_context>x</environment_context>" }],
    })],
    ["an empty-content message", envelope("response_item", {
      type: "message",
      role: "assistant",
      content: [],
    })],
  ] as const) {
    test(`${label} is \`dropped_type\``, () => {
      expect(outcomeOf(line)).toEqual({ kind: "skipped", reason: "dropped_type" })
    })
  }

  test("a retained line comes back as a record", () => {
    const result = outcomeOf(envelope("response_item", {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "do the thing" }],
    }))
    expect(result.kind).toBe("record")
    if (result.kind !== "record") throw new Error("expected a record")
    expect(result.record).toMatchObject({ kind: "user_message", text: "do the thing" })
  })

  // The wrapper keeps its exact signature; nothing that consumes it has to
  // change, and the two can never disagree about whether a line was retained.
  test("classifyRolloutLine is exactly the outcome with the reason erased", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-outcome-"))
    try {
      const fixture = writeCodexRolloutFixture(dir, { sessionId: "sess-outcome", cwd: dir })
      const lines = readFileSync(fixture.rolloutPath, "utf8").split("\n")
      lines.push("{truncated", "", "   ")
      expect(lines.length).toBeGreaterThan(20)
      for (const [lineIndex, line] of lines.entries()) {
        const result = classifyRolloutLineOutcome(line, lineIndex, FALLBACK)
        const legacy = classifyRolloutLine(line, lineIndex, FALLBACK)
        expect(legacy).toEqual(result.kind === "record" ? result.record : null)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("every reason is reachable from one real, damaged file", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-outcome-"))
    try {
      const fixture = writeCodexRolloutFixture(dir, { sessionId: "sess-outcome", cwd: dir })
      // What a half-written rollout looks like: a torn tail and a stray blank.
      const lines = [...readFileSync(fixture.rolloutPath, "utf8").split("\n"), "{\"type\":\"resp"]
      const reasons = new Set(
        lines
          .map((line, lineIndex) => classifyRolloutLineOutcome(line, lineIndex, FALLBACK))
          .flatMap((result) => (result.kind === "skipped" ? [result.reason] : [])),
      )
      expect([...reasons].sort()).toEqual(["blank", "dropped_type", "unparseable"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("against the on-disk fixture", () => {
  test("classifies the importable rollout and drops everything it should", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-rollout-"))
    const fixture = writeCodexRolloutFixture(dir, { sessionId: "sess-fixture", cwd: dir })
    const { records } = classifyFile(fixture.rolloutPath)

    expect(records.map((r) => r.kind)).toEqual([
      "session_meta",
      "model_hint",
      // the synthetic <environment_context> user message and the developer
      // message are both gone; the human turn is first
      "user_message",
      "reasoning",
      "tool_call",
      "assistant_message",
      "tool_output",
      // event_msg/item_completed dropped here
      "tool_call",
      // event_msg/patch_apply_end dropped here
      "tool_output",
      "token_count",
      "token_count",
      "compacted",
      // world_state dropped here
      "tool_call",
      "assistant_message",
      "tool_output",
      "assistant_message",
      "turn_complete",
    ])

    const first = records.find((r) => r.kind === "user_message")
    expect(first?.kind === "user_message" && first.text).toBe("rename the note heading")
  })

  test("the fixture carries no payload.id and no ordinal — the trap it exists for", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-rollout-"))
    const fixture = writeCodexRolloutFixture(dir, { sessionId: "sess-fixture", cwd: dir })
    for (const line of readFileSync(fixture.rolloutPath, "utf8").trim().split("\n")) {
      const parsed = JSON.parse(line)
      expect(parsed.ordinal).toBeUndefined()
      // session_meta's `id` IS the session id, not a per-record key
      if (parsed.type !== "session_meta") expect(parsed.payload.id).toBeUndefined()
    }
  })

  test("compacted's replacement_history never duplicates the transcript", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-rollout-"))
    const fixture = writeCodexRolloutFixture(dir, { sessionId: "sess-fixture", cwd: dir })
    const { records } = classifyFile(fixture.rolloutPath)
    const texts = records.flatMap((r) =>
      r.kind === "user_message" || r.kind === "assistant_message" ? [r.text] : []
    )
    expect(texts).not.toContain("replay one")
    expect(texts).not.toContain("replay two")
    expect(texts).not.toContain("replay three")
  })

  test("line indices stay a pure function of byte position across the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-rollout-"))
    const fixture = writeCodexRolloutFixture(dir, { sessionId: "sess-fixture", cwd: dir })
    const before = classifyFile(fixture.rolloutPath).records

    fixture.appendLine({
      timestamp: "2026-06-07T07:00:00.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "one more thing" }],
      },
    })

    const after = classifyFile(fixture.rolloutPath).records
    // Every previously-classified record keeps its index; only the delta is new.
    expect(after.slice(0, before.length)).toEqual(before)
    const tail = after[after.length - 1]
    expect(tail).toMatchObject({ kind: "user_message", text: "one more thing" })
  })

  test("the subagent variant is refused at its session_meta", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-rollout-"))
    const fixture = writeSubagentRollout(dir, { sessionId: "sess-sub", cwd: dir })
    const { records } = classifyFile(fixture.rolloutPath)
    const meta = records[0]
    if (meta?.kind !== "session_meta") throw new Error("expected session_meta on line 0")
    expect(meta.meta.parentThreadId).toBe("parent-thread-0001")
    expect(isSubagentSessionMeta(meta.meta)).toBe(true)
  })
})
