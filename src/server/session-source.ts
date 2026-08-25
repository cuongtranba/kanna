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
 * `recordKey` and `recordKeyFromEntryId` are INVERSE FUNCTIONS and live on one
 * object deliberately. Every append-storm bug in this pipeline comes from the
 * two drifting: a key the inverse cannot recover reads as "record is new" in
 * `applyDelta`, so a live-tail tick re-appends the whole transcript every two
 * seconds with no error anywhere. Side by side, drift is a one-file review
 * concern, and a colocated property test can assert the round-trip.
 */
export interface SessionRecordCodec<TRecord> {
  /** Records → transcript entries. Entry `_id`s MUST embed `recordKey(record)`. */
  map(records: TRecord[], session: ParsedSession<TRecord>): TranscriptEntry[]
  /**
   * A stable identity for this record, unique within the session and derived
   * only from append-only facts. `null` means "cannot be identified", which
   * `applyDelta` treats as always-new — total implementations avoid that.
   */
  recordKey(record: TRecord): string | null
  /** Recovers `recordKey` from an entry `_id` minted by `map`. */
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
  /** Entries for records whose key is absent from `seenRecordKeys`. */
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
    newEntriesSince: (seenRecordKeys) => {
      const fresh = session.records.filter((record) => {
        const key = codec.recordKey(record)
        return !key || !seenRecordKeys.has(key)
      })
      if (fresh.length === 0) return []
      return codec.map(fresh, session)
    },
    recordKeyFromEntryId: (entryId) => codec.recordKeyFromEntryId(entryId),
    title: () => codec.deriveTitle(session),
    legacyTitleCandidates: () => codec.legacyTitleCandidates(session),
  }
}
