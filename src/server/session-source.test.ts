import { describe, test, expect } from "bun:test"
import type { TranscriptEntry } from "../shared/types"
import {
  createImportableSession,
  type ParsedSession,
  type SessionRecordCodec,
} from "./session-source"

/**
 * A record shaped like the ones both real providers hand over: a stable line
 * key, plus a `pairsWith` field that makes the record's rendering depend on
 * ANOTHER record in the session.
 *
 * That dependency is the point. `createImportableSession` is a
 * record-type-erased shell whose only real decision is what it feeds `map`, and
 * a codec with no cross-record context cannot tell "map everything then filter
 * the entries" from "filter the records then map the subset" — the two agree on
 * every such codec, which is why the subsetting bug survived a full suite.
 */
interface FakeRecord {
  line: number
  text: string
  /** The `line` of the record this one renders against, or null. */
  pairsWith: number | null
}

const KEY_PATTERN = /^(fake#\d+)-/

function fakeKey(record: FakeRecord): string {
  return `fake#${record.line}`
}

/**
 * Deliberately the NAIVE mapper: it resolves `pairsWith` against the records it
 * was handed, so it is only correct when handed all of them. That is the shape
 * the codex mapper had, and the shell is what must protect it — a codec is not
 * required to be correct under subsetting, so the shell must never subset.
 */
function fakeMap(records: FakeRecord[]): TranscriptEntry[] {
  const byLine = new Map(records.map((record) => [record.line, record]))
  return records.map((record) => {
    const partner = record.pairsWith === null ? null : byLine.get(record.pairsWith) ?? null
    const suffix = record.pairsWith === null ? "" : `+${partner?.text ?? "MISSING"}`
    return {
      _id: `${fakeKey(record)}-text-0`,
      kind: "assistant_text",
      createdAt: record.line,
      text: `${record.text}${suffix}`,
    }
  })
}

const fakeCodec: SessionRecordCodec<FakeRecord> = {
  map: fakeMap,
  recordKeyFromEntryId: (entryId) => entryId.match(KEY_PATTERN)?.[1] ?? null,
  deriveTitle: (session) => session.records[0]?.text ?? "Imported session",
  legacyTitleCandidates: () => new Set(["New Chat", "Imported session"]),
}

const RECORDS: FakeRecord[] = [
  { line: 0, text: "call", pairsWith: null },
  { line: 3, text: "chatter", pairsWith: null },
  { line: 7, text: "output", pairsWith: 0 },
]

const SESSION: ParsedSession<FakeRecord> = {
  provider: "codex",
  sessionId: "sess-1",
  filePath: "/tmp/rollout.jsonl",
  cwd: "/tmp",
  firstTimestamp: 1_000,
  lastTimestamp: 9_000,
  records: RECORDS,
  sourceHash: "hash-1",
}

function textOf(entries: TranscriptEntry[]): string[] {
  return entries.map((entry) => (entry.kind === "assistant_text" ? entry.text : entry.kind))
}

describe("createImportableSession — scalar passthrough", () => {
  test("carries every scalar off the parsed session", () => {
    const importable = createImportableSession(SESSION, fakeCodec)
    expect(importable.provider).toBe("codex")
    expect(importable.sessionId).toBe("sess-1")
    expect(importable.filePath).toBe("/tmp/rollout.jsonl")
    expect(importable.cwd).toBe("/tmp")
    expect(importable.firstTimestamp).toBe(1_000)
    expect(importable.lastTimestamp).toBe(9_000)
    expect(importable.sourceHash).toBe("hash-1")
  })

  test("title and legacy candidates delegate to the codec", () => {
    const importable = createImportableSession(SESSION, fakeCodec)
    expect(importable.title()).toBe("call")
    expect([...importable.legacyTitleCandidates()].sort()).toEqual([
      "Imported session",
      "New Chat",
    ])
  })

  test("recordKeyFromEntryId delegates to the codec", () => {
    const importable = createImportableSession(SESSION, fakeCodec)
    expect(importable.recordKeyFromEntryId("fake#7-text-0")).toBe("fake#7")
    expect(importable.recordKeyFromEntryId("not-ours")).toBeNull()
  })
})

describe("toEntries", () => {
  test("maps every record in the session", () => {
    const entries = createImportableSession(SESSION, fakeCodec).toEntries()
    expect(textOf(entries)).toEqual(["call", "chatter", "output+call"])
  })
})

describe("newEntriesSince", () => {
  const importable = createImportableSession(SESSION, fakeCodec)

  test("nothing seen yields exactly toEntries()", () => {
    expect(importable.newEntriesSince(new Set())).toEqual(importable.toEntries())
  })

  test("everything seen yields nothing", () => {
    expect(importable.newEntriesSince(new Set(RECORDS.map(fakeKey)))).toEqual([])
  })

  test("drops precisely the entries whose key is already seen", () => {
    const fresh = importable.newEntriesSince(new Set(["fake#0", "fake#3"]))
    expect(fresh.map((entry) => entry._id)).toEqual(["fake#7-text-0"])
  })

  /**
   * THE test. Mapping only the UNSEEN records hands the mapper a subset in
   * which the paired record is missing, so the surviving entry renders against
   * nothing — `output+MISSING` rather than `output+call`. On the real codex
   * codec that same subsetting turns a multi-file `apply_patch` result into a
   * generic card whose bare `call_id` matches none of the `:change:<i>` ids the
   * call minted, and nothing anywhere reports it.
   */
  test("a partner already imported is still resolved for the fresh entry", () => {
    const fresh = importable.newEntriesSince(new Set(["fake#0", "fake#3"]))
    expect(textOf(fresh)).toEqual(["output+call"])
  })

  test("an entry is rendered identically whether it is fresh or not", () => {
    const whole = importable.toEntries()
    for (const record of RECORDS) {
      const seen = new Set(RECORDS.filter((other) => other !== record).map(fakeKey))
      expect(importable.newEntriesSince(seen)).toEqual(
        whole.filter((entry) => fakeCodec.recordKeyFromEntryId(entry._id) === fakeKey(record)),
      )
    }
  })

  /**
   * `null` from the inverse means "this entry cannot be identified", which the
   * filter treats as ALWAYS-NEW. Deliberate: re-appending an unkeyable entry is
   * visible to the reader, whereas dropping it is silent data loss.
   */
  test("an entry whose key cannot be recovered is always new", () => {
    const unkeyable: SessionRecordCodec<FakeRecord> = {
      ...fakeCodec,
      recordKeyFromEntryId: () => null,
    }
    const always = createImportableSession(SESSION, unkeyable)
    expect(always.newEntriesSince(new Set(RECORDS.map(fakeKey)))).toEqual(always.toEntries())
    expect(always.newEntriesSince(new Set(["fake#0", "fake#3", "fake#7"]))).toHaveLength(3)
  })

  test("a key not in the session is simply not matched by anything", () => {
    expect(importable.newEntriesSince(new Set(["fake#99"]))).toEqual(importable.toEntries())
  })
})

describe("the codec's map is never handed a subset", () => {
  // The invariant `SessionRecordCodec.map` documents, asserted rather than
  // trusted: both paths pass `session.records` in full, and only the ENTRIES
  // are filtered afterwards.
  test("both entry paths call map with the whole record list", () => {
    const seenBatches: FakeRecord[][] = []
    const recording: SessionRecordCodec<FakeRecord> = {
      ...fakeCodec,
      map: (records) => {
        seenBatches.push(records)
        return fakeMap(records)
      },
    }
    const importable = createImportableSession(SESSION, recording)
    importable.toEntries()
    importable.newEntriesSince(new Set(["fake#0"]))
    importable.newEntriesSince(new Set(RECORDS.map(fakeKey)))

    expect(seenBatches).toHaveLength(3)
    for (const batch of seenBatches) expect(batch).toBe(RECORDS)
  })
})
