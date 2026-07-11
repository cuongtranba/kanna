import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, appendFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Query } from "@anthropic-ai/claude-agent-sdk"
import { createClaudeHarnessStream } from "../agent"
import { createJsonlEventParser } from "./jsonl-to-event"
import { startTranscriptStream } from "./tui-source.adapter"
import type { HarnessEvent } from "../harness-types"
import type { ModelPrice } from "../../shared/token-pricing"

/**
 * Phase 6 — SDK ↔ PTY HarnessEvent equivalence matrix.
 *
 * Drives both paths with the same Claude-SDK message fixtures and
 * asserts they emit the same `HarnessEvent` sequence (after stripping
 * volatile fields like `_id` and `createdAt`). The claude CLI mirrors
 * SDKMessage shapes into the JSONL transcript verbatim, so a single
 * fixture stands in for both:
 * - SDK path: yielded from a fake `Query` iterable into
 *   `createClaudeHarnessStream`.
 * - PTY path: serialized to JSON and fed to `createJsonlEventParser`
 *   one line per message.
 */

function fakeQuery(messages: unknown[]): Query {
  const q = (async function* () {
    for (const m of messages) yield m as never
  })()
  return q as unknown as Query
}

function normalize(events: HarnessEvent[]): unknown[] {
  return events.map((ev) => {
    if (ev.type === "transcript") {
      const { _id: _i, createdAt: _c, ...rest } = ev.entry as unknown as Record<string, unknown> & {
        _id?: string
        createdAt?: number
      }
      return { type: ev.type, entry: rest }
    }
    return ev
  })
}

async function collectSdk(messages: unknown[], configuredContextWindow?: number): Promise<HarnessEvent[]> {
  const events: HarnessEvent[] = []
  for await (const ev of createClaudeHarnessStream(fakeQuery(messages), configuredContextWindow)) {
    events.push(ev)
  }
  return events
}

async function ptyEventsViaTranscriptStream(messages: unknown[], configuredContextWindow?: number): Promise<HarnessEvent[]> {
  const tmpDir = await mkdtemp(path.join(tmpdir(), "kanna-parity-"))
  const projectDir = path.join(tmpDir, "projects", "fake")
  await mkdir(projectDir, { recursive: true })
  const filePath = path.join(projectDir, "fixture.jsonl")
  await writeFile(filePath, "")
  const stream = await startTranscriptStream({ projectDir, knownFilePath: filePath, firstFileTimeoutMs: 2000 })
  const parser = createJsonlEventParser({ configuredContextWindow })
  const events: HarnessEvent[] = []
  const writeAll = (async () => {
    for (const m of messages) {
      await appendFile(filePath, `${JSON.stringify(m)  }\n`)
      await new Promise<void>((r) => setTimeout(r, 30))
    }
    await appendFile(filePath, '{"type":"__parity_sentinel__"}\n')
  })()
  const collectDone = (async () => {
    for await (const line of stream.lines) {
      let parsed: { type?: string }
      try { parsed = JSON.parse(line) as { type?: string } } catch { continue }
      if (parsed.type === "__parity_sentinel__") break
      for (const ev of parser.parse(line)) events.push(ev)
    }
  })()
  await writeAll
  await collectDone
  stream.close()
  await rm(tmpDir, { recursive: true, force: true })
  return events
}

async function assertSameEvents(messages: unknown[], configuredContextWindow?: number): Promise<void> {
  const sdk = await collectSdk(messages, configuredContextWindow)
  const pty = await ptyEventsViaTranscriptStream(messages, configuredContextWindow)
  expect(normalize(pty)).toEqual(normalize(sdk))
}

describe("SDK ↔ PTY HarnessEvent equivalence matrix", () => {
  test("simple turn: system/init → assistant → result", async () => {
    await assertSameEvents([
      {
        type: "system",
        subtype: "init",
        session_id: "sess-1",
        model: "claude-sonnet-4-6",
        tools: [],
        mcp_servers: [],
        slash_commands: [],
        cwd: "/tmp",
        permissionMode: "acceptEdits",
        apiKeySource: "none",
        claude_code_version: "0.0.0",
        output_style: "default",
        skills: [],
        plugins: [],
        uuid: "u1",
      },
      {
        type: "assistant",
        session_id: "sess-1",
        message: {
          id: "msg-1",
          role: "assistant",
          content: [{ type: "text", text: "hi" }],
        },
        usage: { input_tokens: 100, output_tokens: 25 },
        uuid: "u2",
      },
      {
        type: "result",
        subtype: "success",
        session_id: "sess-1",
        result: "done",
        is_error: false,
        duration_ms: 500,
        usage: { input_tokens: 100, output_tokens: 25 },
        modelUsage: { "claude-sonnet-4-6": { contextWindow: 200000 } },
        uuid: "u3",
      },
    ])
  })

  test("rate_limit_event (SDK-native shape)", async () => {
    await assertSameEvents([
      {
        type: "rate_limit_event",
        session_id: "sess-rl",
        rate_limit_info: { status: "rejected", resetsAt: 1_748_800_000 },
      },
    ])
  })

  test("prompt-too-long error result", async () => {
    await assertSameEvents([
      {
        type: "result",
        subtype: "error",
        session_id: "sess-err",
        is_error: true,
        result: "prompt is too long",
        duration_ms: 0,
        uuid: "u-err",
      },
    ])
  })

  test("multiple assistant messages dedupe on usage id (same id seen twice)", async () => {
    await assertSameEvents([
      {
        type: "assistant",
        session_id: "sess-d",
        message: { id: "dup", role: "assistant", content: [{ type: "text", text: "a" }] },
        usage: { input_tokens: 10, output_tokens: 3 },
      },
      {
        type: "assistant",
        session_id: "sess-d",
        message: { id: "dup", role: "assistant", content: [{ type: "text", text: "a" }] },
        usage: { input_tokens: 10, output_tokens: 3 },
      },
    ])
  })

  test("1M context window floor preserved against modelUsage.contextWindow=200k", async () => {
    await assertSameEvents(
      [
        {
          type: "assistant",
          session_id: "sess-1m",
          message: { id: "msg-1m", role: "assistant", content: [{ type: "text", text: "x" }] },
          usage: { input_tokens: 100, output_tokens: 50 },
        },
        {
          type: "result",
          subtype: "success",
          session_id: "sess-1m",
          is_error: false,
          duration_ms: 500,
          usage: { input_tokens: 100, output_tokens: 50 },
          modelUsage: { "claude-sonnet-4-6": { contextWindow: 200000 } },
        },
      ],
      1_000_000,
    )
  })

  test("session_token emitted from every message carrying session_id", async () => {
    await assertSameEvents([
      { type: "system", subtype: "init", session_id: "a", model: "m", tools: [], mcp_servers: [], slash_commands: [], cwd: "/", permissionMode: "acceptEdits", apiKeySource: "none", claude_code_version: "0", output_style: "d", skills: [], plugins: [], uuid: "1" },
      { type: "assistant", session_id: "a", message: { id: "m1", role: "assistant", content: [] } },
      { type: "result", subtype: "success", session_id: "a", is_error: false, duration_ms: 0, uuid: "r" },
    ])
  })

  test("rate-limit api_error + error result: result body scrubbed (no duplicate text)", async () => {
    const limitText = "You've hit your limit · resets 11:10pm (Asia/Saigon)"
    const sdk = await collectSdk([
      {
        type: "assistant",
        session_id: "sess-rl",
        uuid: "msg-err",
        isApiErrorMessage: true,
        message: {
          model: "<synthetic>",
          content: [{ type: "text", text: limitText }],
        },
      },
      {
        type: "result",
        subtype: "error",
        session_id: "sess-rl",
        is_error: true,
        result: limitText,
        duration_ms: 2000,
        uuid: "r-err",
      },
    ])
    const apiErrorEntries = sdk.flatMap((ev) =>
      ev.type === "transcript" && ev.entry && ev.entry.kind === "api_error" ? [ev.entry] : [],
    )
    const resultEntries = sdk.flatMap((ev) =>
      ev.type === "transcript" && ev.entry && ev.entry.kind === "result" ? [ev.entry] : [],
    )
    expect(apiErrorEntries).toHaveLength(1)
    expect(apiErrorEntries[0].text).toContain("hit your limit")
    expect(resultEntries).toHaveLength(1)
    expect(resultEntries[0].isError).toBe(true)
    expect(resultEntries[0].result).toBe("")
    expect(resultEntries[0].durationMs).toBe(2000)
  })

  test("compact_boundary turn does not produce phantom context_window_updated", async () => {
    await assertSameEvents([
      {
        type: "system",
        subtype: "compact_boundary",
        session_id: "sess-c",
        compact_metadata: { trigger: "auto", pre_tokens: 50000 },
        uuid: "cb",
      },
      {
        type: "result",
        subtype: "success",
        session_id: "sess-c",
        is_error: false,
        duration_ms: 100,
        usage: { input_tokens: 1000, cache_read_input_tokens: 49000, output_tokens: 0 },
        uuid: "r-c",
      },
    ])
  })
})

describe("createClaudeHarnessStream cost attachment", () => {
  test("claude result cost is attached to the final-turn snapshot", async () => {
    const messages = [
      {
        type: "assistant",
        session_id: "sess-cost",
        message: { id: "m1", role: "assistant", content: [] },
        usage: { input_tokens: 100, output_tokens: 50 },
      },
      {
        type: "result",
        subtype: "success",
        session_id: "sess-cost",
        is_error: false,
        total_cost_usd: 0.0123,
        usage: { input_tokens: 100, output_tokens: 50 },
        duration_ms: 10,
        num_turns: 1,
        result: "ok",
      },
    ]

    const events: HarnessEvent[] = []
    for await (const ev of createClaudeHarnessStream(fakeQuery(messages))) {
      events.push(ev)
    }

    const cwuEntries = events.flatMap((ev) => {
      if (ev.type !== "transcript") return []
      const entry = ev.entry
      return entry && entry.kind === "context_window_updated" ? [entry] : []
    })
    const lastCwu = cwuEntries.at(-1)
    expect(lastCwu).toBeDefined()
    expect(lastCwu!.usage.costUsd).toBeCloseTo(0.0123, 6)
  })

  test("openrouter turn gets computed cost from a price resolver", async () => {
    const messages = [
      {
        type: "assistant",
        session_id: "sess-or",
        message: { id: "m1", role: "assistant", content: [] },
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      },
      {
        type: "result",
        subtype: "success",
        session_id: "sess-or",
        is_error: false,
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
        duration_ms: 10,
        num_turns: 1,
        result: "ok",
      },
    ]

    const price: ModelPrice = { inputPerMTok: 3, outputPerMTok: 15 }
    const events: HarnessEvent[] = []
    for await (const ev of createClaudeHarnessStream(fakeQuery(messages), undefined, () => price)) {
      events.push(ev)
    }

    const cwuEntries = events.flatMap((ev) => {
      if (ev.type !== "transcript") return []
      const entry = ev.entry
      return entry && entry.kind === "context_window_updated" ? [entry] : []
    })
    const lastCwu = cwuEntries.at(-1)
    expect(lastCwu).toBeDefined()
    // 1M input @ $3/M = $3; no cached, no output
    expect(lastCwu!.usage.costUsd).toBeCloseTo(3, 6)
  })
})

describe("result entry usage + cost enrichment", () => {
  test("claude: result entry carries usage tokens and provider costUsd", async () => {
    const messages = [
      {
        type: "assistant",
        session_id: "sess-ru",
        message: { id: "m1", role: "assistant", content: [] },
        usage: { input_tokens: 200, output_tokens: 80 },
      },
      {
        type: "result",
        subtype: "success",
        session_id: "sess-ru",
        is_error: false,
        total_cost_usd: 0.02,
        usage: { input_tokens: 200, output_tokens: 80 },
        duration_ms: 100,
        num_turns: 1,
        result: "done",
      },
    ]

    const events: HarnessEvent[] = []
    for await (const ev of createClaudeHarnessStream(fakeQuery(messages))) {
      events.push(ev)
    }

    const resultEntries = events.flatMap((ev) =>
      ev.type === "transcript" && ev.entry && ev.entry.kind === "result" ? [ev.entry] : [],
    )
    expect(resultEntries).toHaveLength(1)
    const resultEntry = resultEntries[0]
    expect(resultEntry.costUsd).toBeCloseTo(0.02, 6)
    expect(resultEntry.usage).toBeDefined()
    expect(resultEntry.usage?.outputTokens).toBe(80)
    expect(resultEntry.usage?.inputTokens).toBe(200)
  })

  test("openrouter: result entry carries computed cost and usage tokens from resolver", async () => {
    const messages = [
      {
        type: "assistant",
        session_id: "sess-oru",
        message: { id: "m1", role: "assistant", content: [] },
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
      },
      {
        type: "result",
        subtype: "success",
        session_id: "sess-oru",
        is_error: false,
        // no total_cost_usd — OpenRouter doesn't provide it
        usage: { input_tokens: 1_000_000, output_tokens: 0 },
        duration_ms: 10,
        num_turns: 1,
        result: "ok",
      },
    ]

    const price: ModelPrice = { inputPerMTok: 3, outputPerMTok: 15 }
    const events: HarnessEvent[] = []
    for await (const ev of createClaudeHarnessStream(fakeQuery(messages), undefined, () => price)) {
      events.push(ev)
    }

    const resultEntries = events.flatMap((ev) =>
      ev.type === "transcript" && ev.entry && ev.entry.kind === "result" ? [ev.entry] : [],
    )
    expect(resultEntries).toHaveLength(1)
    const resultEntry = resultEntries[0]
    // 1M input @ $3/M = $3
    expect(resultEntry.costUsd).toBeCloseTo(3, 6)
    expect(resultEntry.usage).toBeDefined()
    expect(resultEntry.usage?.inputTokens).toBe(1_000_000)
    // outputTokens is omitted when 0 (normalizeClaudeUsageSnapshot skips zero values)
    expect(resultEntry.usage?.outputTokens).toBeUndefined()
  })
})
