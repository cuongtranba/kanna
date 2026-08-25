// src/server/session-source.ts
//
// The provider-agnostic contract the session importer speaks.
//
// Why the record type is ERASED at this boundary: the importer holds a list of
// sources with DIFFERENT record types (claude JSONL records, codex rollout
// records). A `SessionSource<TRecord>[]` cannot be written without an
// existential, and the only encodings TypeScript offers for one are `any` or
// `unknown` — both banned repo-wide by TYPE_STRICT_SYNTAX in eslint.config.js.
// So a source hands back an `ImportableSession`: the parsed data with its
// provider's pure behaviour already bound to it. TRecord stays inside the
// implementation, the importer never names it, and no cast is needed anywhere.

import type { AgentProvider, TranscriptEntry } from "../shared/types"

/**
 * A session parsed off disk, still carrying its provider-specific records.
 * Implementations pair this with a `SessionRecordCodec` to produce the erased
 * `ImportableSession` the importer consumes.
 */
export interface ParsedSession<TRecord> {
  provider: AgentProvider
  sessionId: string
  filePath: string
  cwd: string
  firstTimestamp: number
  lastTimestamp: number
  records: TRecord[]
  sourceHash: string
}

/**
 * The pure, provider-specific half of a session source.
 *
 * IDENTITY LIVES ON THE ENTRY, NOT ON THE RECORD. There is exactly ONE keying
 * function here — `recordKeyFromEntryId` — and it reads an `_id` that `map`
 * minted. A provider still needs a private record→key helper to mint those ids
 * (`codexRecordKey`, `claudeRecordKey`), but it is not a port slot, because a
 * second slot is a second thing to keep in sync: this interface used to carry
 * `recordKey` as well, and every append-storm bug in this pipeline was the two
 * drifting — a key the inverse cannot recover reads as "record is new", so a
 * live-tail tick re-appends the whole transcript every two seconds with no
 * error anywhere.
 *
 * With one function, `toEntries` and `newEntriesSince` both run `map` over the
 * WHOLE session and differ only in a filter over the resulting entries. That is
 * what makes drift unrepresentable rather than merely tested — and it is why
 * `map` is never handed a subset (see `createImportableSession`).
 */
export interface SessionRecordCodec<TRecord> {
  /**
   * Records → transcript entries.
   *
   * Called with `session.records` in full, ALWAYS. A mapper may therefore rely
   * on cross-record context — codex pairs a `tool_output` with the
   * `tool_call` that produced it, and a subset that dropped the call would
   * silently degrade the result to a generic card with a tool id matching
   * nothing the call minted.
   *
   * Every entry `_id` MUST be recoverable by `recordKeyFromEntryId`, or the
   * entry reads as always-new on every tick.
   */
  map(records: TRecord[], session: ParsedSession<TRecord>): TranscriptEntry[]
  /**
   * The identity of the record that produced this entry — a stable key, unique
   * within the session and derived only from append-only facts.
   *
   * `null` means "this entry cannot be identified", which the delta filter
   * treats as ALWAYS-NEW. Total implementations avoid that.
   */
  recordKeyFromEntryId(entryId: string): string | null
  deriveTitle(session: ParsedSession<TRecord>): string
  /**
   * Titles a previous Kanna version may have written for this session. The
   * importer only renames a chat whose current title is one of these, so a
   * title the user set by hand is never clobbered.
   */
  legacyTitleCandidates(session: ParsedSession<TRecord>): ReadonlySet<string>
}

/** A parsed session with its provider's behaviour bound — record type erased. */
export interface ImportableSession {
  readonly provider: AgentProvider
  readonly sessionId: string
  readonly filePath: string
  readonly cwd: string
  readonly firstTimestamp: number
  readonly lastTimestamp: number
  readonly sourceHash: string
  /** Entries for every record in the session. */
  toEntries(): TranscriptEntry[]
  /**
   * `toEntries()` minus the entries whose record key is already in
   * `seenRecordKeys`. An entry whose key cannot be recovered is always new.
   */
  newEntriesSince(seenRecordKeys: ReadonlySet<string>): TranscriptEntry[]
  /** Inverse of the entry-id scheme `toEntries` mints. */
  recordKeyFromEntryId(entryId: string): string | null
  title(): string
  legacyTitleCandidates(): ReadonlySet<string>
}

/**
 * Why a file produced no session.
 *
 * A superset of every provider's own rejection vocabulary, so a provider-local
 * union (e.g. `CodexParseRejection`) is assignable here without a cast.
 */
export type SessionParseRejection =
  /** stat/open/read failed, or the path is not a regular file. */
  | "unreadable"
  /** Readable, but nothing identified the session (no meta / no session id). */
  | "no_session_meta"
  /** The session meta carried no usable `cwd`. */
  | "no_cwd"
  /** A subagent / forked rollout. Not imported in v1. */
  | "subagent"
  /** Readable and identified, but nothing was retained. */
  | "no_records"
  /** The provider's parser refused the file without saying more. */
  | "parse_failed"

/**
 * The outcome of parsing one file.
 *
 * This is a UNION rather than `ImportableSession | null` because `null` cannot
 * say WHY. A 91 MB rollout refused on size and an unparseable file are two
 * different facts for the user — one is actionable ("raise the cap"), the other
 * is not — and collapsing both onto `null` reported the first as the second.
 */
export type SessionParseResult =
  | { readonly kind: "parsed"; readonly session: ImportableSession }
  | { readonly kind: "tooLarge"; readonly size: number; readonly maxBytes: number }
  | { readonly kind: "rejected"; readonly reason: SessionParseRejection }

/** Where a provider's sessions live on disk. Implementations perform IO. */
export interface SessionSource {
  readonly provider: AgentProvider
  /** Every importable session under `homeDir`. */
  scan(homeDir: string): ImportableSession[]
  /** Path of the file holding `sessionId`, or null if this provider has none. */
  locate(homeDir: string, sessionId: string): string | null
  /** Parse one file. Never throws — a failure is a `rejected` / `tooLarge` result. */
  parse(filePath: string): SessionParseResult
}

/** Binds a parsed session to its codec, erasing the record type. Pure. */
export function createImportableSession<TRecord>(
  session: ParsedSession<TRecord>,
  codec: SessionRecordCodec<TRecord>,
): ImportableSession {
  return {
    provider: session.provider,
    sessionId: session.sessionId,
    filePath: session.filePath,
    cwd: session.cwd,
    firstTimestamp: session.firstTimestamp,
    lastTimestamp: session.lastTimestamp,
    sourceHash: session.sourceHash,
    toEntries: () => codec.map(session.records, session),
    /**
     * MAP EVERYTHING, THEN FILTER THE ENTRIES. Filtering the RECORDS first and
     * mapping the subset is the same function on paper and not in practice: it
     * forces every mapper to be correct under subsetting, an invariant stated
     * nowhere and one codex does not hold. On a tick where a `tool_call` is
     * already imported and only its `tool_output` is new, the subset drops the
     * call, the output degrades to a generic card, and its bare `call_id`
     * matches none of the `:change:<i>` ids a multi-file `apply_patch` minted —
     * so the reader is left with Edit cards stuck "in progress" plus an orphan,
     * and nothing fails.
     *
     * Mapping the whole session also makes this and `toEntries` literally the
     * same call, so the two can no longer disagree about what an entry is.
     *
     * COST: the caller re-reads and re-parses the whole file on every live-tail
     * tick anyway, so re-mapping already-in-memory records is small change
     * against IO already paid.
     */
    newEntriesSince: (seenRecordKeys) =>
      codec.map(session.records, session).filter((entry) => {
        const key = codec.recordKeyFromEntryId(entry._id)
        return key === null || !seenRecordKeys.has(key)
      }),
    recordKeyFromEntryId: (entryId) => codec.recordKeyFromEntryId(entryId),
    title: () => codec.deriveTitle(session),
    legacyTitleCandidates: () => codec.legacyTitleCandidates(session),
  }
}
