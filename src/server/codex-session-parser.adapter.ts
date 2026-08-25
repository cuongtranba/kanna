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

import { createHash } from "node:crypto"
import { closeSync, openSync, readSync, statSync } from "node:fs"
import { StringDecoder } from "node:string_decoder"
import type { CodexRolloutRecord, CodexSessionMeta } from "./codex-session-types"
import type { ParsedSession } from "./session-source"

/** Bytes read per `readSync`. One page-friendly MiB; the remainder is carried. */
const READ_CHUNK_BYTES = 1024 * 1024

/**
 * Bytes hashed from each end of the file for `sourceHash`. Hashing the whole
 * file would re-read every byte we just streamed and defeat the point; head +
 * tail + size + mtime changes on every append, which is all the hash is for.
 */
const HASH_WINDOW_BYTES = 64 * 1024

/** Prefix of `sourceHash`. Readable on purpose — a future shrink-guard parses it. */
export const CODEX_SOURCE_HASH_PREFIX = "codex:v1"

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

export type CodexParseResult =
  | { readonly kind: "parsed"; readonly session: ParsedSession<CodexRolloutRecord> }
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
}

/**
 * Classifies one physical line and folds it into `state`.
 * Returns false to stop reading the file (a subagent meta — see below).
 */
function consumeLine(line: string, lineIndex: number, state: ScanState, deps: CodexParserDeps): boolean {
  // A `\r\n` file must not hand the classifier a trailing CR.
  const text = line.endsWith("\r") ? line.slice(0, -1) : line
  // Blank lines can never classify. Skipping them without calling out is the
  // one shortcut taken here; `lineIndex` has already accounted for them.
  if (text.trim().length === 0) return true

  const record = deps.classifyLine(text, lineIndex, state.fallbackTimestamp)
  if (!record) return true

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
  if (pending.length > 0) consumeLine(pending, lineIndex, state, deps)
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

  if (state.isSubagent) return rejected("subagent")
  if (state.records.length === 0) return rejected("no_records")
  if (!state.meta) return rejected("no_session_meta")
  if (!state.meta.cwd) return rejected("no_cwd")

  return {
    kind: "parsed",
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
