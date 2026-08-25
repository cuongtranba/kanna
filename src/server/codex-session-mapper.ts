// src/server/codex-session-mapper.ts
//
// The codex half of `SessionRecordCodec` — classified rollout records in,
// transcript entries out, plus the identity functions that make an import
// idempotent. PURE: no `node:fs`, no `process.env`, no `Bun` global. Every
// tool card is rendered by the LIVE translator, never re-derived here.
//
// THE CARDINAL RULE: EVERY ENTRY IS KEYED ON THE LINE THAT PRODUCED IT.
//
// A `tool_result` is keyed on its OUTPUT record's line, never on the call's.
// The two sit on different lines and routinely arrive in different live-tail
// ticks; keying both on the call's line makes the second tick see that key
// already present, filter the record out as "seen", and the tool_result never
// lands. Silent data loss, no error, no failing test unless one is written for
// exactly this — which is why the colocated suite asserts the round trip over
// every entry the fixture produces.

import type { TranscriptEntry } from "../shared/types"
import type { ThreadItem } from "./codex-app-server-protocol"
import {
  buildResultEntry,
  codexSystemInitEntry,
  normalizeCodexTokenUsage,
  todoToolCall,
  translateItemToToolCalls,
  translateItemToToolResults,
  withEntryIdentity,
  type TranslationContext,
} from "./codex-transcript-translator"
import {
  rolloutToolCallToThreadItem,
  rolloutToolOutputToThreadItem,
} from "./codex-rollout-to-thread-item"
import type {
  CodexReasoningRecord,
  CodexRolloutRecord,
  CodexToolCallRecord,
} from "./codex-session-types"
import type { ParsedSession, SessionRecordCodec } from "./session-source"

const TITLE_MAX_LENGTH = 60
const IMPORTED_SESSION_TITLE = "Imported session"
const NEW_CHAT_TITLE = "New Chat"
const FALLBACK_MODEL = "codex"

/**
 * A record's stable identity, minted into every entry `_id` this module
 * produces. **TOTAL — this never returns null.**
 *
 * MODULE-LOCAL BY DESIGN. `SessionRecordCodec` carries no `recordKey` slot;
 * `codexRecordKeyFromEntryId` is the only keying function the importer sees,
 * and it reads the `_id` rather than the record. A codex record always has a
 * `lineIndex` (the parser counts every physical line), so there is nothing to
 * be unsure about — widening the return to `string | null` would put an
 * unkeyable entry back on the wire, and an entry the inverse cannot recover
 * reads as ALWAYS-NEW: the append storm.
 *
 * It deliberately does NOT include the session id: a key only needs to be
 * unique within its own chat, and one chat is one session. The `codex#` prefix
 * keeps ids self-describing and cannot collide with claude's uuid-shaped keys.
 */
export function codexRecordKey(record: CodexRolloutRecord): string {
  return `codex#${record.lineIndex}`
}

/**
 * Anchored on `codex#<digits>` and NOTHING else, which makes it
 * SUFFIX-VOCABULARY-INDEPENDENT: adding a new entry kind below needs no change
 * here. That is the whole point. Rewriting it to enumerate the suffixes turns
 * every future entry kind into an unkeyable record — i.e. into an append storm
 * that no existing test would catch.
 */
const ENTRY_ID_PATTERN = /^(codex#\d+)-/

export function codexRecordKeyFromEntryId(entryId: string): string | null {
  return entryId.match(ENTRY_ID_PATTERN)?.[1] ?? null
}

// ---------------------------------------------------------------------------
// per-record mapping
// ---------------------------------------------------------------------------

function entryId(record: CodexRolloutRecord, suffix: string): string {
  return `${codexRecordKey(record)}-${suffix}`
}

/**
 * The model name for `system_init`. `session_meta.model_provider` is a PROVIDER
 * id (`openai`, `cliproxyapi`), never a model, so `model_hint` — the classifier's
 * narrowing of `turn_context` / `thread_settings_applied` — is the only source.
 * Read off the WHOLE session rather than the records being mapped: a live-tail
 * delta carrying only later lines still needs the model the session opened with.
 */
function deriveModel(session: ParsedSession<CodexRolloutRecord>): string {
  for (const record of session.records) {
    if (record.kind === "model_hint" && record.model !== null) return record.model
  }
  return FALLBACK_MODEL
}

/**
 * `summary` is empty in every record of the reference corpus (7455/7455), so
 * this branch is expected to produce nothing — it is kept because the field is
 * the only readable half of a reasoning record (`encrypted_content` is not ours
 * to decode) and a future Codex may start populating it.
 */
function thinkingEntries(record: CodexReasoningRecord): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  for (let i = 0; i < record.summary.length; i += 1) {
    const text = record.summary[i].trim()
    if (text.length === 0) continue
    entries.push({
      _id: entryId(record, `thinking-${i}`),
      kind: "assistant_thinking",
      createdAt: record.timestamp,
      text,
    })
  }
  return entries
}

/** Re-stamps every entry a translator helper produced onto THIS record's line. */
function stamped(
  record: CodexRolloutRecord,
  prefix: string,
  entries: TranscriptEntry[],
): TranscriptEntry[] {
  return entries.map((entry, index) =>
    withEntryIdentity(entry, entryId(record, `${prefix}-${index}`), record.timestamp),
  )
}

/** `stamped` for a helper that returns exactly one entry, with no `-<i>`. */
function stampedSingle(
  record: CodexRolloutRecord,
  suffix: string,
  entry: TranscriptEntry,
): TranscriptEntry[] {
  return [withEntryIdentity(entry, entryId(record, suffix), record.timestamp)]
}

function toolCallEntries(record: CodexToolCallRecord): TranscriptEntry[] {
  const mapping = rolloutToolCallToThreadItem(record)
  if (mapping.kind === "plan") {
    return stamped(record, "tool_call", [todoToolCall(mapping.callId, mapping.steps)])
  }
  return stamped(record, "tool_call", translateItemToToolCalls(mapping.item, null))
}

/**
 * `result` entries go through `buildResultEntry` so an imported turn carries the
 * same shape a live one does. Its `durationMs` is hardcoded 0 there (the live
 * path has no duration at that point); the rollout DOES carry one, so it is
 * overridden after the fact. The `kind` narrowing is what lets the override
 * typecheck against the entry union without a cast.
 */
function resultEntry(
  record: CodexRolloutRecord,
  subtype: "cancelled" | "success",
  text: string,
  durationMs: number,
): TranscriptEntry {
  const built = withEntryIdentity(
    buildResultEntry(subtype, text, null, undefined),
    entryId(record, "result"),
    record.timestamp,
  )
  return built.kind === "result" ? { ...built, durationMs } : built
}

/**
 * A `web_search` record carries no `call_id` of its own, so its record key
 * doubles as the item id. That keeps the call and its (absent) result joinable
 * and stays unique — one line produces one web search.
 */
function webSearchItem(record: CodexRolloutRecord, query: string): ThreadItem {
  return { type: "webSearch", id: codexRecordKey(record), query }
}

function mapRecord(
  record: CodexRolloutRecord,
  session: ParsedSession<CodexRolloutRecord>,
  ctx: TranslationContext,
  callsById: Map<string, CodexToolCallRecord>,
): TranscriptEntry[] {
  switch (record.kind) {
    case "session_meta":
      return stampedSingle(record, "system_init", codexSystemInitEntry(deriveModel(session)))

    case "user_message":
      // The classifier already dropped synthetic openers and the `developer`
      // role. Re-filtering here would be a second, drifting copy of that rule.
      return [{
        _id: entryId(record, "user"),
        kind: "user_prompt",
        createdAt: record.timestamp,
        content: record.text,
      }]

    case "assistant_message":
      return [{
        _id: entryId(record, "text-0"),
        kind: "assistant_text",
        createdAt: record.timestamp,
        text: record.text,
      }]

    case "reasoning":
      return thinkingEntries(record)

    case "tool_call":
      return toolCallEntries(record)

    case "web_search":
      return stamped(
        record,
        "tool_call",
        translateItemToToolCalls(webSearchItem(record, record.query), null),
      )

    case "tool_output": {
      // `null` on a miss is REQUIRED, not defensive: a live-tail delta can hold
      // an output whose call landed in an earlier tick, and the output mapper
      // degrades to a `dynamicToolCall`-shaped item that still carries the
      // call_id — so the result still joins to the right row.
      const call = callsById.get(record.callId) ?? null
      const item = rolloutToolOutputToThreadItem(record, call)
      return stamped(record, "tool_result", translateItemToToolResults(item, ctx))
    }

    case "token_count": {
      if (record.info === null) return []
      const usage = normalizeCodexTokenUsage({
        threadId: session.sessionId,
        turnId: "",
        tokenUsage: record.info,
      })
      if (usage === null) return []
      return [{
        _id: entryId(record, "usage"),
        kind: "context_window_updated",
        createdAt: record.timestamp,
        usage,
      }]
    }

    case "turn_complete":
      return [resultEntry(record, "success", record.lastAgentMessage, record.durationMs)]

    case "turn_aborted":
      return [
        { _id: entryId(record, "interrupted"), kind: "interrupted", createdAt: record.timestamp },
        resultEntry(record, "cancelled", record.reason, record.durationMs),
      ]

    case "compacted":
      // ONE boundary and nothing else. `CodexCompactedRecord` carries no summary
      // and no `replacement_history` by construction — the latter is a full
      // replay of the conversation, and a mapper that walks it duplicates the
      // entire transcript while every assertion still passes.
      return [{
        _id: entryId(record, "compact_boundary"),
        kind: "compact_boundary",
        createdAt: record.timestamp,
      }]

    case "model_hint":
      // Consumed by `deriveModel`; it is not an event a reader sees.
      return []
  }
}

export function mapCodexRecordsToEntries(
  records: CodexRolloutRecord[],
  session: ParsedSession<CodexRolloutRecord>,
): TranscriptEntry[] {
  const ctx: TranslationContext = {
    projectId: null,
    cwd: session.cwd,
    relocate: (externalPath: string) => externalPath,
  }
  // Built over the WHOLE session, never over `records`. `createImportableSession`
  // only ever passes the full list, but a mapper whose fidelity depends on that
  // is one refactor away from silently losing the pairing — and the loss shows
  // as a multi-file `apply_patch` whose result joins to no card it opened, with
  // no error anywhere. Reading the session makes the subset case impossible
  // rather than merely unused.
  const callsById = new Map<string, CodexToolCallRecord>()
  for (const record of session.records) {
    if (record.kind === "tool_call") callsById.set(record.callId, record)
  }
  const entries: TranscriptEntry[] = []
  for (const record of records) {
    entries.push(...mapRecord(record, session, ctx, callsById))
  }
  return entries
}

// ---------------------------------------------------------------------------
// title
// ---------------------------------------------------------------------------

export function deriveCodexTitle(session: ParsedSession<CodexRolloutRecord>): string {
  for (const record of session.records) {
    if (record.kind !== "user_message") continue
    const trimmed = record.text.trim()
    if (trimmed.length === 0) continue
    return trimmed.slice(0, TITLE_MAX_LENGTH).trim()
  }
  return IMPORTED_SESSION_TITLE
}

/**
 * Titles a previous Kanna version may have written for this session. The
 * importer only renames a chat whose CURRENT title is one of these, so a title
 * the user set by hand is never clobbered by a re-import.
 */
function codexLegacyTitleCandidates(): ReadonlySet<string> {
  return new Set([NEW_CHAT_TITLE, IMPORTED_SESSION_TITLE])
}

export const codexSessionCodec: SessionRecordCodec<CodexRolloutRecord> = {
  map: mapCodexRecordsToEntries,
  recordKeyFromEntryId: codexRecordKeyFromEntryId,
  deriveTitle: deriveCodexTitle,
  legacyTitleCandidates: codexLegacyTitleCandidates,
}
