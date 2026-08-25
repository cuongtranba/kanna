import { describe, test, expect } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeCodexRolloutFixture } from "./__fixtures__/codex-rollout-fixture"
import { classifyRolloutLine, isSubagentSessionMeta } from "./codex-rollout-line"
import { parseCodexRolloutFile } from "./codex-session-parser.adapter"
import {
  codexRecordKey,
  codexRecordKeyFromEntryId,
  codexSessionCodec,
  deriveCodexTitle,
  mapCodexRecordsToEntries,
} from "./codex-session-mapper"
import { translateItemToToolCalls } from "./codex-transcript-translator"
import type { CodexRolloutRecord, CodexToolOutputRecord } from "./codex-session-types"
import type { ParsedSession } from "./session-source"

const MAX_BYTES = 64 * 1024 * 1024

function loadFixtureSession(): ParsedSession<CodexRolloutRecord> {
  const cwd = mkdtempSync(join(tmpdir(), "codex-mapper-"))
  const fixture = writeCodexRolloutFixture(cwd, { sessionId: "sess-mapper-1", cwd })
  const result = parseCodexRolloutFile(fixture.rolloutPath, {
    classifyLine: classifyRolloutLine,
    isSubagentMeta: isSubagentSessionMeta,
    maxBytes: MAX_BYTES,
  })
  if (result.kind !== "parsed") throw new Error(`fixture did not parse: ${result.kind}`)
  return result.session
}

const SESSION = loadFixtureSession()
const RECORDS = SESSION.records
const ENTRIES = mapCodexRecordsToEntries(RECORDS, SESSION)

function recordsOfKind<K extends CodexRolloutRecord["kind"]>(
  kind: K,
): Extract<CodexRolloutRecord, { kind: K }>[] {
  const isKind = (
    record: CodexRolloutRecord,
  ): record is Extract<CodexRolloutRecord, { kind: K }> => record.kind === kind
  return RECORDS.filter(isKind)
}

function sessionWith(records: CodexRolloutRecord[]): ParsedSession<CodexRolloutRecord> {
  return { ...SESSION, records }
}

/**
 * Entries attributable to `records[index]`, by differencing two prefix passes.
 *
 * Mapping is prefix-deterministic (the call↔output map is built as the pass
 * walks the records in line order), so the entries of the (i+1)-prefix are
 * exactly the entries of the i-prefix followed by record i's own. That is what
 * makes "the record that PRODUCED it" a fact here rather than an assumption.
 */
function entriesProducedBy(index: number) {
  const before = mapCodexRecordsToEntries(RECORDS.slice(0, index), SESSION)
  const through = mapCodexRecordsToEntries(RECORDS.slice(0, index + 1), SESSION)
  return through.slice(before.length)
}

describe("codexRecordKey", () => {
  // A null key reads as ALWAYS-NEW in the importer's delta filter, which is the
  // append-storm path: every live-tail tick re-appends the whole transcript.
  test("is total over every fixture record", () => {
    expect(RECORDS.length).toBeGreaterThan(0)
    for (const record of RECORDS) {
      const key = codexRecordKey(record)
      expect(key).toBe(`codex#${record.lineIndex}`)
      expect(key.length).toBeGreaterThan(0)
    }
  })

  test("keys are unique across the session", () => {
    const keys = new Set(RECORDS.map(codexRecordKey))
    expect(keys.size).toBe(RECORDS.length)
  })

  test("does not embed the session id — one chat is one session", () => {
    expect(codexRecordKey(RECORDS[0])).not.toContain(SESSION.sessionId)
  })
})

describe("recordKey ↔ recordKeyFromEntryId round trip", () => {
  // THE test. Every append-storm bug in this pipeline is these two drifting.
  test("every produced entry recovers the key of the record that produced it", () => {
    expect(ENTRIES.length).toBeGreaterThan(0)
    let seen = 0
    for (let i = 0; i < RECORDS.length; i += 1) {
      const expected = codexRecordKey(RECORDS[i])
      for (const entry of entriesProducedBy(i)) {
        expect(codexRecordKeyFromEntryId(entry._id)).toBe(expected)
        seen += 1
      }
    }
    expect(seen).toBe(ENTRIES.length)
  })

  test("a tool_result is keyed on its OUTPUT line, never on the call's", () => {
    const outputs = recordsOfKind("tool_output")
    expect(outputs.length).toBeGreaterThan(0)
    const callKeys = new Set(recordsOfKind("tool_call").map(codexRecordKey))
    for (const output of outputs) {
      const produced = ENTRIES.filter(
        (entry) => codexRecordKeyFromEntryId(entry._id) === codexRecordKey(output),
      )
      expect(produced.length).toBeGreaterThan(0)
      expect(callKeys.has(codexRecordKey(output))).toBe(false)
    }
  })

  test("is suffix-vocabulary-independent — an unknown suffix still recovers", () => {
    expect(codexRecordKeyFromEntryId("codex#42-some_future_kind-7")).toBe("codex#42")
  })

  test("returns null for an id that is not ours", () => {
    expect(codexRecordKeyFromEntryId("9f1c2b3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d-text-0")).toBeNull()
    expect(codexRecordKeyFromEntryId("codex#-user")).toBeNull()
    expect(codexRecordKeyFromEntryId("")).toBeNull()
  })
})

describe("determinism", () => {
  test("mapping the same records twice yields identical _ids", () => {
    const first = mapCodexRecordsToEntries(RECORDS, SESSION)
    const second = mapCodexRecordsToEntries(RECORDS, SESSION)
    expect(second.map((entry) => entry._id)).toEqual(first.map((entry) => entry._id))
  })

  test("entry ids are unique within one pass", () => {
    const ids = new Set(ENTRIES.map((entry) => entry._id))
    expect(ids.size).toBe(ENTRIES.length)
  })

  test("createdAt is the producing record's timestamp", () => {
    for (let i = 0; i < RECORDS.length; i += 1) {
      for (const entry of entriesProducedBy(i)) {
        expect(entry.createdAt).toBe(RECORDS[i].timestamp)
      }
    }
  })
})

describe("split tool pair", () => {
  // Required, not defensive: a live-tail delta legitimately holds an output
  // whose call landed in a tick already imported.
  test("mapping ONLY the output still yields a tool_result on the call_id", () => {
    const output: CodexToolOutputRecord = recordsOfKind("tool_output")[0]
    const entries = mapCodexRecordsToEntries([output], sessionWith([output]))
    const results = entries.filter((entry) => entry.kind === "tool_result")
    expect(results.length).toBe(1)
    expect(results[0].toolId).toBe(output.callId)
    expect(codexRecordKeyFromEntryId(results[0]._id)).toBe(codexRecordKey(output))
  })
})

describe("rendering parity with the live translator", () => {
  // Asserted against the live translator's OWN output, never a string literal:
  // a literal pins today's wording and lets the import path drift silently.
  test("an exec tool call renders as the live path's Bash card", () => {
    const exec = recordsOfKind("tool_call").find((record) => record.name === "exec_command")
    if (!exec) throw new Error("fixture lost its exec_command call")
    const index = RECORDS.indexOf(exec)
    const produced = entriesProducedBy(index)
    const imported = produced.filter((entry) => entry.kind === "tool_call")
    expect(imported.length).toBe(1)

    const live = translateItemToToolCalls(
      { type: "commandExecution", id: exec.callId, command: "cat notes.md", status: "inProgress" },
      null,
    ).filter((entry) => entry.kind === "tool_call")
    expect(live.length).toBe(1)

    expect(imported[0].tool.toolKind).toBe(live[0].tool.toolKind)
    expect(imported[0].tool.toolName).toBe(live[0].tool.toolName)
    expect(imported[0].tool.toolKind).toBe("bash")
    expect(imported[0].tool.toolName).toBe("Bash")
    expect(imported[0].tool.toolId).toBe(exec.callId)
  })
})

describe("compaction", () => {
  test("a compacted record yields exactly one compact_boundary and no replay", () => {
    const compacted = recordsOfKind("compacted")
    expect(compacted.length).toBe(1)
    const produced = entriesProducedBy(RECORDS.indexOf(compacted[0]))
    expect(produced.length).toBe(1)
    expect(produced[0].kind).toBe("compact_boundary")

    // `replacement_history` is a full replay of the conversation so far; a
    // mapper that walks it duplicates the whole transcript with nothing failing.
    const serialized = JSON.stringify(ENTRIES)
    expect(serialized).not.toContain("replay one")
    expect(serialized).not.toContain("replay two")
    expect(serialized).not.toContain("replay three")
    expect(ENTRIES.some((entry) => entry.kind === "compact_summary")).toBe(false)
  })
})

describe("token_count", () => {
  test("info: null produces no entry and does not throw", () => {
    const nulls = recordsOfKind("token_count").filter((record) => record.info === null)
    expect(nulls.length).toBe(1)
    expect(entriesProducedBy(RECORDS.indexOf(nulls[0]))).toEqual([])
  })

  test("a populated info produces one context_window_updated", () => {
    const populated = recordsOfKind("token_count").filter((record) => record.info !== null)
    expect(populated.length).toBe(1)
    const produced = entriesProducedBy(RECORDS.indexOf(populated[0]))
    expect(produced.length).toBe(1)
    const usage = produced[0]
    if (usage.kind !== "context_window_updated") throw new Error("expected usage entry")
    expect(usage.usage.usedTokens).toBe(13380)
    expect(usage.usage.maxTokens).toBe(258400)
  })
})

describe("session_meta", () => {
  test("yields one system_init carrying the model from the first model_hint", () => {
    const meta = recordsOfKind("session_meta")
    expect(meta.length).toBe(1)
    const produced = entriesProducedBy(RECORDS.indexOf(meta[0]))
    expect(produced.length).toBe(1)
    const init = produced[0]
    if (init.kind !== "system_init") throw new Error("expected system_init")
    expect(init.model).toBe("gpt-5.6-sol")
    expect(init.provider).toBe("codex")
  })

  test("falls back to \"codex\" when no model_hint carries a model", () => {
    const withoutHints = RECORDS.filter((record) => record.kind !== "model_hint")
    const session = sessionWith(withoutHints)
    const init = mapCodexRecordsToEntries(withoutHints, session)
      .filter((entry) => entry.kind === "system_init")
    expect(init.length).toBe(1)
    expect(init[0].model).toBe("codex")
  })

  test("model_hint itself produces no entry", () => {
    for (const hint of recordsOfKind("model_hint")) {
      expect(entriesProducedBy(RECORDS.indexOf(hint))).toEqual([])
    }
  })
})

describe("turn terminals", () => {
  test("turn_complete yields one success result carrying the rollout duration", () => {
    const complete = recordsOfKind("turn_complete")
    expect(complete.length).toBe(1)
    const produced = entriesProducedBy(RECORDS.indexOf(complete[0]))
    expect(produced.length).toBe(1)
    const result = produced[0]
    if (result.kind !== "result") throw new Error("expected result")
    expect(result.subtype).toBe("success")
    expect(result.isError).toBe(false)
    expect(result.result).toBe("Heading renamed.")
    // `buildResultEntry` hardcodes 0; the rollout's own duration must win.
    expect(result.durationMs).toBe(2899)
  })

  test("turn_aborted yields interrupted + a cancelled result on the same line", () => {
    const aborted: CodexRolloutRecord = {
      kind: "turn_aborted",
      lineIndex: 99,
      timestamp: SESSION.lastTimestamp,
      reason: "user interrupt",
      durationMs: 1234,
    }
    const entries = mapCodexRecordsToEntries([aborted], sessionWith([aborted]))
    expect(entries.map((entry) => entry.kind)).toEqual(["interrupted", "result"])
    for (const entry of entries) {
      expect(codexRecordKeyFromEntryId(entry._id)).toBe("codex#99")
    }
    const result = entries[1]
    if (result.kind !== "result") throw new Error("expected result")
    expect(result.subtype).toBe("cancelled")
    expect(result.durationMs).toBe(1234)
  })
})

describe("messages", () => {
  test("the synthetic opener and developer preamble never reach the transcript", () => {
    const prompts = ENTRIES.filter((entry) => entry.kind === "user_prompt")
    expect(prompts.length).toBe(1)
    expect(prompts[0].content).toBe("rename the note heading")
    const serialized = JSON.stringify(ENTRIES)
    expect(serialized).not.toContain("environment_context")
    expect(serialized).not.toContain("Skill: pragmatic")
  })

  test("reasoning with an empty summary produces nothing", () => {
    for (const reasoning of recordsOfKind("reasoning")) {
      expect(reasoning.summary).toEqual([])
      expect(entriesProducedBy(RECORDS.indexOf(reasoning))).toEqual([])
    }
  })

  test("a reasoning summary with text becomes assistant_thinking", () => {
    const reasoning: CodexRolloutRecord = {
      kind: "reasoning",
      lineIndex: 77,
      timestamp: SESSION.firstTimestamp,
      summary: ["  ", "Considering the rename."],
    }
    const entries = mapCodexRecordsToEntries([reasoning], sessionWith([reasoning]))
    expect(entries.length).toBe(1)
    const thinking = entries[0]
    if (thinking.kind !== "assistant_thinking") throw new Error("expected thinking")
    expect(thinking.text).toBe("Considering the rename.")
    expect(codexRecordKeyFromEntryId(thinking._id)).toBe("codex#77")
  })
})

describe("web_search", () => {
  test("routes through the live tool-call path", () => {
    const search: CodexRolloutRecord = {
      kind: "web_search",
      lineIndex: 55,
      timestamp: SESSION.firstTimestamp,
      query: "codex rollout format",
    }
    const entries = mapCodexRecordsToEntries([search], sessionWith([search]))
    const calls = entries.filter((entry) => entry.kind === "tool_call")
    expect(calls.length).toBe(1)
    const live = translateItemToToolCalls(
      { type: "webSearch", id: "codex#55", query: "codex rollout format" },
      null,
    ).filter((entry) => entry.kind === "tool_call")
    expect(calls[0].tool.toolKind).toBe(live[0].tool.toolKind)
    expect(calls[0].tool.toolName).toBe(live[0].tool.toolName)
    expect(codexRecordKeyFromEntryId(calls[0]._id)).toBe("codex#55")
  })
})

describe("deriveCodexTitle", () => {
  test("uses the first real user message", () => {
    expect(deriveCodexTitle(SESSION)).toBe("rename the note heading")
  })

  test("truncates to 60 characters", () => {
    const long: CodexRolloutRecord = {
      kind: "user_message",
      lineIndex: 4,
      timestamp: SESSION.firstTimestamp,
      text: "x".repeat(200),
    }
    expect(deriveCodexTitle(sessionWith([long]))).toBe("x".repeat(60))
  })

  test("falls back to \"Imported session\" with no user message", () => {
    const noUser = RECORDS.filter((record) => record.kind !== "user_message")
    expect(deriveCodexTitle(sessionWith(noUser))).toBe("Imported session")
  })
})

describe("codexSessionCodec", () => {
  test("exposes the pure parts as its slots", () => {
    expect(codexSessionCodec.recordKey(RECORDS[0])).toBe(codexRecordKey(RECORDS[0]))
    expect(codexSessionCodec.deriveTitle(SESSION)).toBe(deriveCodexTitle(SESSION))
    expect(codexSessionCodec.map(RECORDS, SESSION).length).toBe(ENTRIES.length)
  })

  test("legacyTitleCandidates covers only titles Kanna itself wrote", () => {
    const candidates = codexSessionCodec.legacyTitleCandidates(SESSION)
    expect([...candidates].sort()).toEqual(["Imported session", "New Chat"])
    expect(candidates.has("rename the note heading")).toBe(false)
  })
})
