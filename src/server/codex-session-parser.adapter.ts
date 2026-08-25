// src/server/codex-session-parser.adapter.ts
//
// Streams ONE codex rollout JSONL off disk and hands back a `ParsedSession`.
//
// Streaming is a correctness requirement here, not an optimisation. The largest
// rollout on the reference machine is 91 MB (then 33, 12, 6.7), and this repo
// already has a measured incident where a 96 MB transcript cost ~524 MB RSS to
// parse because it was read whole and `split("\n")`-ed — the string, the array
// of lines, and the parsed objects are all live at once. So: `openSync` + one
// reused 1 MiB buffer + `readSync`, splitting on `\n` with the remainder carried
// across chunk boundaries. Only the CLASSIFIED records are retained, so a 30 MB
// rollout never holds 30 MB of raw JSON.
//
// Classification is INJECTED (`CodexParserDeps`), never imported. This adapter
// is a leaf: it wraps `node:fs` + `node:crypto` and holds no domain knowledge
// about what a rollout line means. The classifier is the domain half and lives
// in a pure module.
//
// A dropped line is COUNTED when the injected classifier can say why it was
// dropped (`classifyLineWithReason`), because "corrupt" and "deliberately not
// retained" are the same `null` otherwise — and a rollout quietly missing turns
// still imports green. See `CodexLineDiagnostics`.

import { createHash } from "node:crypto"
import { closeSync, openSync, readSync, statSync } from "node:fs"
import { StringDecoder } from "node:string_decoder"
import { log } from "../shared/log"
import type { CodexRolloutRecord, CodexSessionMeta } from "./codex-session-types"
import type { ParsedSession } from "./session-source"

/**
 * Bytes read per `readSync`. One page-friendly MiB; the remainder is carried.
 *
 * Exported because the boundary-straddling test has to build a line that lands
 * on it — a second copy in the test with a "keep these in sync" comment is the
 * drift this repo bans.
 */
export const READ_CHUNK_BYTES = 1024 * 1024

/**
 * Bytes hashed from each end of the file for `sourceHash`. Hashing the whole
 * file would re-read every byte we just streamed and defeat the point; head +
 * tail + size + mtime changes on every append, which is all the hash is for.
 */
const HASH_WINDOW_BYTES = 64 * 1024

/** Prefix of `sourceHash`. Readable on purpose — `parseCodexSourceHash` parses it. */
export const CODEX_SOURCE_HASH_PREFIX = "codex:v1"

/** The facts `sourceHash` carries in the clear. See `computeSourceHash`. */
export interface CodexSourceHashParts {
  readonly size: number
  readonly mtimeMs: number
  readonly digest: string
}

function positiveNumberOrNull(raw: string | undefined): number | null {
  // `Number("")` is 0, so an empty field has to be rejected before the parse.
  if (raw === undefined || raw.length === 0) return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Reads `size` / `mtimeMs` / `digest` back off a `sourceHash`, or null when the
 * string was not minted by THIS version of `computeSourceHash`.
 *
 * Null is not an error: a hash from another provider, or from a future
 * `codex:v2`, simply carries no size this code may reason about.
 */
export function parseCodexSourceHash(sourceHash: string): CodexSourceHashParts | null {
  const parts = sourceHash.split(":")
  if (parts.length !== 5) return null
  if (`${parts[0]}:${parts[1]}` !== CODEX_SOURCE_HASH_PREFIX) return null
  const size = positiveNumberOrNull(parts[2])
  const mtimeMs = positiveNumberOrNull(parts[3])
  const digest = parts[4] ?? ""
  if (size === null || mtimeMs === null || digest.length === 0) return null
  return { size, mtimeMs, digest }
}

/**
 * True when the file behind `currentSourceHash` is SMALLER than the one behind
 * `previousSourceHash` — the one thing a codex delta import must refuse.
 *
 * A codex record key is `codex#<lineIndex>` and `lineIndex` is a pure function
 * of byte position, so any rewrite that shifts line numbers (a rotation, a
 * truncation, a re-serialised rollout) re-keys every record past the shift.
 * `applyDelta` then reads all of them as new and re-appends the whole
 * transcript with no error anywhere. A shrink is the one such rewrite that can
 * be DETECTED without re-reading the file, because the size rides the hash.
 *
 * The live-tail path is already covered by the registry's
 * `stat.size > entry.lastSize` gate; the manual paths — re-importing an
 * already-imported id, and "Import all" — have no size gate at all and are why
 * this exists. **Callers on those paths must consult it before applying a
 * delta** and refuse visibly (a full re-import is the honest recovery).
 *
 * False when either hash is unreadable: absence of evidence, not evidence of
 * absence — an unparseable hash says nothing about the file's size.
 */
export function hasCodexSourceShrunk(previousSourceHash: string, currentSourceHash: string): boolean {
  const previous = parseCodexSourceHash(previousSourceHash)
  const current = parseCodexSourceHash(currentSourceHash)
  if (previous === null || current === null) return false
  return current.size < previous.size
}

/**
 * Why a rollout produced no session. Distinguishing these is the whole reason
 * the result is a union: "too big to import" is actionable for the user, while
 * "unparseable" is not, and collapsing both onto `null` produced a misleading
 * message on exactly the files most likely to matter.
 */
export type CodexParseRejection =
  /** stat/open/read failed, or the path is not a regular file. */
  | "unreadable"
  /** No `session_meta` record anywhere in the file. */
  | "no_session_meta"
  /** `session_meta` carried no usable `cwd`. */
  | "no_cwd"
  /** `isSubagentMeta` said so. v1 does not import subagent/forked rollouts. */
  | "subagent"
  /** Readable and identified, but the classifier retained nothing. */
  | "no_records"

/**
 * Why one physical line produced no record.
 *
 * `classifyLine` collapses all three onto `null`, which is why a half-written
 * or disk-corrupted rollout imports as a transcript quietly missing turns under
 * a green "imported". Only `unparseable` is a defect worth telling anyone about
 * — `blank` and `dropped` are the format working as designed.
 */
export type CodexLineSkipReason = "blank" | "unparseable" | "dropped"

export type CodexLineClassification =
  | { readonly kind: "record"; readonly record: CodexRolloutRecord }
  | { readonly kind: "skipped"; readonly reason: CodexLineSkipReason }

/** What the scan noticed about lines it kept nothing from. */
export interface CodexLineDiagnostics {
  /**
   * Physical lines the classifier could not parse at all — "codex changed its
   * format" or "your disk is failing", as distinct from a deliberate drop.
   *
   * `null` means CANNOT DISTINGUISH: no `classifyLineWithReason` was injected,
   * so a corrupt line and an intentional drop are the same `null` and any count
   * would be a claim this adapter is not entitled to make. Zero means the file
   * was scanned WITH a reason classifier and held no corrupt line.
   */
  readonly unparseableLines: number | null
  /**
   * The file's last line had no trailing newline and did not parse — codex
   * caught mid-write. Excluded from `unparseableLines` on purpose: the next
   * tick re-reads the same byte offset and the record arrives at the SAME
   * `lineIndex`, so this is the design working, not corruption, and warning on
   * it would mean an alarming line every poll of every actively-written file.
   */
  readonly truncatedFinalLine: boolean
}

export type CodexParseResult =
  | {
      readonly kind: "parsed"
      readonly session: ParsedSession<CodexRolloutRecord>
      readonly diagnostics: CodexLineDiagnostics
    }
  | { readonly kind: "tooLarge"; readonly size: number; readonly maxBytes: number }
  | { readonly kind: "rejected"; readonly reason: CodexParseRejection }

export interface CodexParserDeps {
  /**
   * Narrows one physical line to a record, or `null` to drop it.
   *
   * `lineIndex` counts EVERY physical line — blank and unparseable included —
   * so it stays a pure function of byte position and widening the retain table
   * later cannot renumber anything already imported.
   *
   * `fallbackTimestamp` is the session's first known timestamp once one has
   * been seen, and the file's mtime before that.
   */
  classifyLine(rawLine: string, lineIndex: number, fallbackTimestamp: number): CodexRolloutRecord | null
  /**
   * OPTIONAL. The same decision as `classifyLine`, plus WHY a line was dropped.
   *
   * When supplied it is used INSTEAD of `classifyLine` — one parse per line,
   * full information. When absent the adapter cannot tell a corrupt line from
   * an intentional drop and reports `unparseableLines: null` rather than
   * guessing. `classifyLine` stays required so a host that has not adopted the
   * companion classifier is unchanged.
   */
  classifyLineWithReason?(rawLine: string, lineIndex: number, fallbackTimestamp: number): CodexLineClassification
  isSubagentMeta(meta: CodexSessionMeta): boolean
  /** Files larger than this are refused as `tooLarge` before a byte is read. */
  maxBytes: number
}

function rejected(reason: CodexParseRejection): CodexParseResult {
  return { kind: "rejected", reason }
}

/** Reads exactly `length` bytes at `position` into `buffer`, short read tolerated. */
function readWindow(fd: number, buffer: Buffer, position: number, length: number): Buffer {
  let filled = 0
  while (filled < length) {
    const read = readSync(fd, buffer, filled, length - filled, position + filled)
    if (read <= 0) break
    filled += read
  }
  return buffer.subarray(0, filled)
}

/**
 * `codex:v1:<size>:<mtimeMs>:<md5 of head 64KiB + tail 64KiB>`.
 *
 * Windows may overlap on a file under 128 KiB. That is fine — it is
 * deterministic, which is the only property the hash needs.
 */
function computeSourceHash(fd: number, buffer: Buffer, size: number, mtimeMs: number): string {
  const hash = createHash("md5")
  const headLength = Math.min(HASH_WINDOW_BYTES, size)
  if (headLength > 0) hash.update(readWindow(fd, buffer, 0, headLength))
  const tailStart = Math.max(0, size - HASH_WINDOW_BYTES)
  const tailLength = size - tailStart
  if (tailLength > 0) hash.update(readWindow(fd, buffer, tailStart, tailLength))
  return `${CODEX_SOURCE_HASH_PREFIX}:${size}:${mtimeMs}:${hash.digest("hex")}`
}

interface ScanState {
  readonly records: CodexRolloutRecord[]
  meta: CodexSessionMeta | null
  isSubagent: boolean
  first: number
  last: number
  fallbackTimestamp: number
  unparseableLines: number
  truncatedFinalLine: boolean
}

/** One line → a record or the reason there is none. Reasons only when injected. */
function classifyOne(
  text: string,
  lineIndex: number,
  state: ScanState,
  deps: CodexParserDeps,
): CodexLineClassification {
  if (deps.classifyLineWithReason) return deps.classifyLineWithReason(text, lineIndex, state.fallbackTimestamp)
  const record = deps.classifyLine(text, lineIndex, state.fallbackTimestamp)
  // No reason dep: a drop is a drop, and `unparseableLines` stays null.
  return record ? { kind: "record", record } : { kind: "skipped", reason: "dropped" }
}

/**
 * Classifies one physical line and folds it into `state`.
 * Returns false to stop reading the file (a subagent meta — see below).
 */
function consumeLine(line: string, lineIndex: number, state: ScanState, deps: CodexParserDeps): boolean {
  // A `\r\n` file must not hand the classifier a trailing CR.
  const text = line.endsWith("\r") ? line.slice(0, -1) : line
  // Blank lines can never classify, and their reason is not in doubt, so they
  // never reach the classifier; `lineIndex` has already accounted for them.
  if (text.trim().length === 0) return true

  const classified = classifyOne(text, lineIndex, state, deps)
  if (classified.kind === "skipped") {
    if (classified.reason === "unparseable") state.unparseableLines += 1
    return true
  }
  const record = classified.record

  if (!state.meta && record.kind === "session_meta") {
    state.meta = record.meta
    if (deps.isSubagentMeta(record.meta)) {
      // Stop here rather than streaming the rest: 99 of 534 rollouts on the
      // reference machine are subagent/forked, and one of them is 91 MB.
      state.isSubagent = true
      return false
    }
  }

  if (Number.isFinite(record.timestamp)) {
    if (record.timestamp < state.first) state.first = record.timestamp
    if (record.timestamp > state.last) state.last = record.timestamp
    if (state.records.length === 0) state.fallbackTimestamp = record.timestamp
  }

  state.records.push(record)
  return true
}

/** Streams the file, splitting on `\n` and carrying the remainder across chunks. */
function scanFile(fd: number, buffer: Buffer, size: number, state: ScanState, deps: CodexParserDeps): void {
  // A multi-byte UTF-8 sequence can straddle a chunk boundary; the decoder
  // holds the partial bytes back instead of emitting a replacement char.
  const decoder = new StringDecoder("utf8")
  let pending = ""
  let lineIndex = 0
  let position = 0

  while (position < size) {
    const read = readSync(fd, buffer, 0, Math.min(READ_CHUNK_BYTES, size - position), position)
    if (read <= 0) break
    position += read

    pending += decoder.write(buffer.subarray(0, read))
    let start = 0
    let newline = pending.indexOf("\n", start)
    while (newline !== -1) {
      if (!consumeLine(pending.slice(start, newline), lineIndex, state, deps)) return
      lineIndex += 1
      start = newline + 1
      newline = pending.indexOf("\n", start)
    }
    pending = pending.slice(start)
  }

  // A final line with no trailing newline is a real line, not a remainder.
  pending += decoder.end()
  if (pending.length === 0) return
  const unparseableBefore = state.unparseableLines
  consumeLine(pending, lineIndex, state, deps)
  if (state.unparseableLines > unparseableBefore) {
    // Codex caught mid-write. Expected on every actively-written rollout, so it
    // is recorded as its own fact instead of inflating the corruption count.
    state.unparseableLines = unparseableBefore
    state.truncatedFinalLine = true
  }
}

/**
 * Parses one `rollout-*.jsonl`. The file is stat'd before it is opened, so an
 * over-cap rollout costs one syscall and never enters memory.
 */
export function parseCodexRolloutFile(filePath: string, deps: CodexParserDeps): CodexParseResult {
  let size: number
  let mtimeMs: number
  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) return rejected("unreadable")
    size = stat.size
    mtimeMs = stat.mtimeMs
  } catch {
    return rejected("unreadable")
  }

  if (size > deps.maxBytes) return { kind: "tooLarge", size, maxBytes: deps.maxBytes }

  const state: ScanState = {
    records: [],
    meta: null,
    isSubagent: false,
    first: Number.POSITIVE_INFINITY,
    last: Number.NEGATIVE_INFINITY,
    fallbackTimestamp: mtimeMs,
    unparseableLines: 0,
    truncatedFinalLine: false,
  }

  let sourceHash: string
  let fd: number
  try {
    fd = openSync(filePath, "r")
  } catch {
    return rejected("unreadable")
  }
  try {
    const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES)
    // Hash first: both use explicit positions, so neither disturbs the other,
    // and the early-out on a subagent meta must not skip the head/tail reads.
    sourceHash = computeSourceHash(fd, buffer, size, mtimeMs)
    scanFile(fd, buffer, size, state, deps)
  } catch {
    return rejected("unreadable")
  } finally {
    try {
      closeSync(fd)
    } catch {
      // An fd we can no longer close is not a parse failure.
    }
  }

  // Once per file, and only for corruption — a truncated final line is already
  // excluded, so an actively-written rollout polled every two seconds says
  // nothing. This is the line that separates "codex changed its format" from
  // "your disk is failing"; without it both import green and short a few turns.
  if (state.unparseableLines > 0) {
    log.warn(`[kanna/import] rollout had ${state.unparseableLines} unparseable lines ${filePath}`)
  }

  if (state.isSubagent) return rejected("subagent")
  if (state.records.length === 0) return rejected("no_records")
  if (!state.meta) return rejected("no_session_meta")
  if (!state.meta.cwd) return rejected("no_cwd")

  return {
    kind: "parsed",
    diagnostics: {
      unparseableLines: deps.classifyLineWithReason ? state.unparseableLines : null,
      truncatedFinalLine: state.truncatedFinalLine,
    },
    session: {
      provider: "codex",
      sessionId: state.meta.sessionId,
      filePath,
      cwd: state.meta.cwd,
      firstTimestamp: Number.isFinite(state.first) ? state.first : mtimeMs,
      lastTimestamp: Number.isFinite(state.last) ? state.last : mtimeMs,
      records: state.records,
      sourceHash,
    },
  }
}
