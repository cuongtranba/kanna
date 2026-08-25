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
import { createImportableSession, type ParsedSession } from "./session-source"

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

  // A `codex#<n>` key trivially contains no session id — that assertion cannot
  // fail. What CAN fail is the number being a counter over RETAINED records
  // instead of the physical line: both read `codex#<n>`, and the counter form
  // renumbers every already-imported record the moment the classifier's retain
  // table widens. The fixture drops lines, so the two disagree here.
  test("the key counts PHYSICAL lines, not retained records", () => {
    const drift = RECORDS.filter((record, index) => record.lineIndex !== index)
    expect(drift.length).toBeGreaterThan(0)
    for (const record of drift) {
      expect(codexRecordKey(record)).toBe(`codex#${record.lineIndex}`)
      expect(codexRecordKey(record)).not.toBe(`codex#${RECORDS.indexOf(record)}`)
    }
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
  /**
   * The multi-file `apply_patch` output. Picking THIS one rather than
   * `recordsOfKind("tool_output")[0]` is the whole point: the exec output's
   * tool id is the bare `call_id` either way, so a test over it passes
   * identically whether or not the call was resolved — it cannot fail.
   */
  function multiFileOutput(): CodexToolOutputRecord {
    const call = recordsOfKind("tool_call").find(
      (record) => record.name === "apply_patch" && record.input.includes("second.ts"),
    )
    if (!call) throw new Error("fixture lost its multi-file apply_patch call")
    const output = recordsOfKind("tool_output").find((record) => record.callId === call.callId)
    if (!output) throw new Error("fixture lost the multi-file apply_patch output")
    return output
  }

  function expectedChangeToolIds(callId: string): string[] {
    return [`${callId}:change:0`, `${callId}:change:1`]
  }

  // Required, not defensive: a live-tail delta legitimately holds an output
  // whose call landed in a tick already imported. The SESSION still holds the
  // call, so the pairing is recoverable and fidelity must not degrade.
  test("mapping ONLY the output keeps the call's per-change tool ids", () => {
    const output = multiFileOutput()
    const entries = mapCodexRecordsToEntries([output], SESSION)
    const results = entries.filter((entry) => entry.kind === "tool_result")
    expect(results.map((entry) => entry.toolId)).toEqual(expectedChangeToolIds(output.callId))
    for (const entry of results) {
      expect(codexRecordKeyFromEntryId(entry._id)).toBe(codexRecordKey(output))
    }
  })

  // The `:change:<i>` ids the CALL minted must be exactly the ones the output
  // produces — a bare `call_id` result matches none of them, so every card the
  // call opened stays "in progress" forever.
  test("the call's tool ids and the output's tool ids are the same set", () => {
    const output = multiFileOutput()
    const call = recordsOfKind("tool_call").find((record) => record.callId === output.callId)
    if (!call) throw new Error("fixture lost the multi-file apply_patch call")

    const callIds = mapCodexRecordsToEntries([call], SESSION)
      .filter((entry) => entry.kind === "tool_call")
      .map((entry) => entry.tool.toolId)
    const resultIds = mapCodexRecordsToEntries([output], SESSION)
      .filter((entry) => entry.kind === "tool_result")
      .map((entry) => entry.toolId)

    expect(callIds).toEqual(expectedChangeToolIds(output.callId))
    expect(resultIds).toEqual(callIds)
  })

  // The genuine fallback: the call is absent from the SESSION too, not merely
  // from the records being mapped. Then there is nothing to recover and the
  // bare `call_id` is the best available join key.
  test("an output whose call the session never saw degrades to the bare call_id", () => {
    const output = multiFileOutput()
    const entries = mapCodexRecordsToEntries([output], sessionWith([output]))
    const results = entries.filter((entry) => entry.kind === "tool_result")
    expect(results.length).toBe(1)
    expect(results[0].toolId).toBe(output.callId)
  })
})

describe("newEntriesSince over the real codec", () => {
  /**
   * The live-tail tick this whole file exists for: the `tool_call` line was
   * imported last tick and only its `tool_output` line is new.
   *
   * The delta path must map the SAME way the store path does. Mapping only the
   * unseen RECORDS makes every mapper carry an unwritten "must be correct under
   * subsetting" invariant, and codex does not: `callsById` loses the call, the
   * output degrades to a generic `dynamicOutput`, and its bare `call_id`
   * matches none of the `:change:<i>` ids the call minted.
   */
  test("an output-only tick still carries the call's per-change tool ids", () => {
    const call = recordsOfKind("tool_call").find(
      (record) => record.name === "apply_patch" && record.input.includes("second.ts"),
    )
    if (!call) throw new Error("fixture lost its multi-file apply_patch call")
    const output = recordsOfKind("tool_output").find((record) => record.callId === call.callId)
    if (!output) throw new Error("fixture lost the multi-file apply_patch output")

    const importable = createImportableSession(SESSION, codexSessionCodec)
    // Everything up to and including the call has been imported already.
    const seen = new Set(
      RECORDS.filter((record) => record.lineIndex <= call.lineIndex).map(codexRecordKey),
    )

    const fresh = importable.newEntriesSince(seen)
    const results = fresh.filter((entry) => entry.kind === "tool_result")
    expect(results.map((entry) => entry.toolId)).toEqual([
      `${call.callId}:change:0`,
      `${call.callId}:change:1`,
    ])
  })

  test("the delta holds exactly the entries of the unseen records", () => {
    const importable = createImportableSession(SESSION, codexSessionCodec)
    const seenRecords = RECORDS.slice(0, 6)
    const seen = new Set(seenRecords.map(codexRecordKey))

    const fresh = importable.newEntriesSince(seen)
    const expected = ENTRIES.filter((entry) => {
      const key = codexRecordKeyFromEntryId(entry._id)
      return key === null || !seen.has(key)
    })
    expect(fresh.map((entry) => entry._id)).toEqual(expected.map((entry) => entry._id))
  })

  test("nothing seen yields the whole transcript; everything seen yields none", () => {
    const importable = createImportableSession(SESSION, codexSessionCodec)
    expect(importable.newEntriesSince(new Set()).map((entry) => entry._id))
      .toEqual(ENTRIES.map((entry) => entry._id))
    expect(importable.newEntriesSince(new Set(RECORDS.map(codexRecordKey)))).toEqual([])
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
  test("a compacted record with a summary yields boundary THEN summary", () => {
    const compacted = recordsOfKind("compacted")
    expect(compacted.length).toBe(1)
    expect(compacted[0].summary).toBe("Summary of the conversation so far.")

    const produced = entriesProducedBy(RECORDS.indexOf(compacted[0]))
    // The order is load-bearing: `buildHistoryPrimer` resumes at the LAST
    // boundary and counts `compact_summary` as assistant content, so a summary
    // emitted before its own boundary is discarded.
    expect(produced.map((entry) => entry.kind)).toEqual(["compact_boundary", "compact_summary"])
    const summary = produced[1]
    if (summary.kind !== "compact_summary") throw new Error("expected compact_summary")
    expect(summary.summary).toBe("Summary of the conversation so far.")
  })

  test("both entries are keyed on the same line, with distinct stable ids", () => {
    const compacted = recordsOfKind("compacted")[0]
    const produced = entriesProducedBy(RECORDS.indexOf(compacted))
    const key = codexRecordKey(compacted)
    for (const entry of produced) {
      expect(codexRecordKeyFromEntryId(entry._id)).toBe(key)
      expect(entry.createdAt).toBe(compacted.timestamp)
    }
    expect(new Set(produced.map((entry) => entry._id)).size).toBe(produced.length)
    // Stable across passes — a re-import must not mint a second summary card.
    expect(mapCodexRecordsToEntries([compacted], SESSION).map((entry) => entry._id))
      .toEqual(produced.map((entry) => entry._id))
  })

  test("a compacted record with no summary yields the boundary alone", () => {
    const bare: CodexRolloutRecord = {
      kind: "compacted",
      lineIndex: 88,
      timestamp: SESSION.lastTimestamp,
      summary: null,
    }
    const entries = mapCodexRecordsToEntries([bare], sessionWith([bare]))
    expect(entries.map((entry) => entry.kind)).toEqual(["compact_boundary"])
  })

  test("the replay is never walked", () => {
    // `replacement_history` is a full replay of the conversation so far; a
    // mapper that walks it duplicates the whole transcript with nothing failing.
    const serialized = JSON.stringify(ENTRIES)
    expect(serialized).not.toContain("replay one")
    expect(serialized).not.toContain("replay two")
    expect(serialized).not.toContain("replay three")
    expect(ENTRIES.filter((entry) => entry.kind === "compact_summary").length).toBe(1)
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
  // The property, not the wiring: `codexSessionCodec.map === mapCodexRecordsToEntries`
  // can only fail on something TypeScript already rejects, so asserting it
  // asserts nothing. What CAN fail is the inverse not recovering an id `map`
  // minted — an entry the importer cannot key reads as always-new forever.
  test("every id its map mints is recoverable by its own recordKeyFromEntryId", () => {
    const entries = codexSessionCodec.map(RECORDS, SESSION)
    expect(entries.length).toBeGreaterThan(0)
    const recordKeys = new Set(RECORDS.map(codexRecordKey))
    for (const entry of entries) {
      const key = codexSessionCodec.recordKeyFromEntryId(entry._id)
      expect(key).not.toBeNull()
      expect(recordKeys.has(key ?? "")).toBe(true)
    }
  })

  test("derives the title from the session", () => {
    expect(codexSessionCodec.deriveTitle(SESSION)).toBe("rename the note heading")
  })

  test("legacyTitleCandidates covers only titles Kanna itself wrote", () => {
    const candidates = codexSessionCodec.legacyTitleCandidates(SESSION)
    expect([...candidates].sort()).toEqual(["Imported session", "New Chat"])
    expect(candidates.has("rename the note heading")).toBe(false)
  })
})
