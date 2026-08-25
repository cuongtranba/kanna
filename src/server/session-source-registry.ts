// src/server/session-source-registry.ts
//
// The list of providers the session importer knows how to read. Adding a
// provider is one entry here plus its own scanner/parser/codec — the importer
// itself never names a provider.
//
// NOT `.adapter.ts`: this file performs no IO of its own. It is a composition
// root holding domain policy — provider precedence, the default size cap, and
// the claude parser's `null` → `parse_failed` mapping — and merely wires the
// scanner + parser adapters (which do the file IO) onto their pure codec.
// CLAUDE.md reserves the suffix for a file whose SINGLE responsibility is to
// perform the side effect; importing an `.adapter.ts` from a plain module is
// allowed and is all this does.

import type { AgentProvider } from "../shared/types"
import { claudeSessionCodec } from "./claude-session-mapper"
import { parseClaudeSessionFile } from "./claude-session-parser.adapter"
import { locateClaudeSessionFile, scanClaudeSessions } from "./claude-session-scanner.adapter"
import {
  classifyRolloutLine,
  classifyRolloutLineOutcome,
  isSubagentSessionMeta,
  type RolloutLineSkipReason,
} from "./codex-rollout-line"
import { codexSessionCodec } from "./codex-session-mapper"
import {
  parseCodexRolloutFile,
  type CodexLineSkipReason,
  type CodexParserDeps,
} from "./codex-session-parser.adapter"
import { locateCodexRolloutFile, scanCodexRollouts } from "./codex-session-scanner.adapter"
import {
  createImportableSession,
  type ImportableSession,
  type SessionParseRejection,
  type SessionParseResult,
  type SessionSource,
} from "./session-source"

/**
 * Default ceiling on one rollout file. The largest rollout on the reference
 * machine is 91 MB and parsing a file that size is a measured half-gigabyte of
 * RSS, so the cap exists to refuse it deliberately rather than to OOM. It is a
 * PARAMETER rather than a constant because `server.ts` overrides it from
 * `KANNA_IMPORT_MAX_ROLLOUT_BYTES` — the registry itself reads no environment.
 */
export const DEFAULT_MAX_ROLLOUT_BYTES = 32 * 1024 * 1024

export const claudeSessionSource: SessionSource = {
  provider: "claude",
  scan: (homeDir) =>
    scanClaudeSessions(homeDir).map((session) => createImportableSession(session, claudeSessionCodec)),
  locate: (homeDir, sessionId) => locateClaudeSessionFile(homeDir, sessionId),
  parse: (filePath): SessionParseResult => {
    const session = parseClaudeSessionFile(filePath)
    // The claude parser answers `null` for every failure it can hit — it reads
    // the file whole, so it has no size branch and draws no distinction between
    // "unreadable" and "no session id". `parse_failed` is that one bucket.
    if (!session) return { kind: "rejected", reason: "parse_failed" }
    return { kind: "parsed", session: createImportableSession(session, claudeSessionCodec) }
  },
}

/**
 * The pure half of the codex pipeline, injected into the IO half. The parser is
 * a leaf that knows nothing about what a rollout line means; the classifier is
 * the domain half and stays out of the adapter.
 */
/**
 * Translates the classifier's skip vocabulary into the parser's.
 *
 * The two are declared independently — the classifier is pure domain, the
 * parser is an IO leaf that must not import it — so this is the one seam where
 * they meet. Exhaustive with no `default`, so a new skip reason on either side
 * is a compile error here rather than a silently mistranslated diagnostic.
 */
function toParserSkipReason(reason: RolloutLineSkipReason): CodexLineSkipReason {
  switch (reason) {
    case "blank":
      return "blank"
    case "unparseable":
      return "unparseable"
    case "dropped_type":
      return "dropped"
  }
}

/**
 * Exported so a test can assert the codex parser is actually given the
 * skip-reason companion. Without it `diagnostics.unparseableLines` is `null`
 * ("cannot distinguish") forever, and because the port drops `diagnostics` on
 * the way to the importer, nothing downstream would ever notice.
 */
export function codexParserDeps(maxBytes: number): CodexParserDeps {
  return {
    classifyLine: classifyRolloutLine,
    // Supplying this is what makes `unparseableLines` a number instead of
    // `null` ("cannot distinguish"): without it a corrupt rollout line and a
    // deliberately-dropped `world_state` are the same event, and a half-written
    // file imports short with a green result and no warning.
    classifyLineWithReason: (rawLine, lineIndex, fallbackTimestamp) => {
      const outcome = classifyRolloutLineOutcome(rawLine, lineIndex, fallbackTimestamp)
      if (outcome.kind === "record") return outcome
      return { kind: "skipped", reason: toParserSkipReason(outcome.reason) }
    },
    isSubagentMeta: isSubagentSessionMeta,
    maxBytes,
  }
}

/**
 * Why the scan would not offer a file.
 *
 * `SessionSource.scan` answers `ImportableSession[]`, so a file it refuses is
 * simply absent — it reaches no counter and no log. That is fine for the
 * per-id path (which parses one named file and reports the result) and wrong
 * for "import all": with 99 subagent rollouts and 4 over-cap files a user sees
 * "imported N" and cannot learn that 103 were refused, or why.
 */
export type SessionScanRefusalReason = SessionParseRejection | "too_large"

export interface SessionScanRefusal {
  readonly provider: AgentProvider
  readonly filePath: string
  readonly reason: SessionScanRefusalReason
}

export interface SessionScanResult {
  readonly sessions: ImportableSession[]
  readonly refusals: SessionScanRefusal[]
}

/**
 * Walks every codex rollout under `homeDir`, appending to BOTH lists.
 *
 * Shared by `SessionSource.scan` (which discards the refusals to keep the
 * provider-agnostic contract) and `scanAllSessions` (which keeps them). One
 * loop, so the two can never disagree about which files were offered.
 */
function scanCodexInto(
  homeDir: string,
  parse: (filePath: string) => SessionParseResult,
  sessions: ImportableSession[],
  refusals: SessionScanRefusal[],
): void {
  for (const filePath of scanCodexRollouts(homeDir)) {
    const result = parse(filePath)
    if (result.kind === "parsed") {
      sessions.push(result.session)
      continue
    }
    const reason: SessionScanRefusalReason = result.kind === "tooLarge" ? "too_large" : result.reason
    refusals.push({ provider: "codex", filePath, reason })
  }
}

export function createCodexSessionSource(maxBytes = DEFAULT_MAX_ROLLOUT_BYTES): SessionSource {
  const deps = codexParserDeps(maxBytes)
  const parse = (filePath: string): SessionParseResult => {
    const result = parseCodexRolloutFile(filePath, deps)
    if (result.kind !== "parsed") return result
    return { kind: "parsed", session: createImportableSession(result.session, codexSessionCodec) }
  }
  return {
    provider: "codex",
    // A full scan parses every rollout, so the size cap and the subagent refusal
    // both apply here. Callers that need to REPORT what was refused go through
    // `scanAllSessions` instead — this signature can only drop it.
    scan: (homeDir) => {
      const sessions: ImportableSession[] = []
      scanCodexInto(homeDir, parse, sessions, [])
      return sessions
    },
    locate: (homeDir, sessionId) => locateCodexRolloutFile(homeDir, sessionId),
    parse,
  }
}

export const codexSessionSource: SessionSource = createCodexSessionSource()

/**
 * Ordered — `importSessionsByIds` probes sources in this order, first hit wins.
 *
 * Claude is first, so a uuid that exists under BOTH `~/.claude/projects` and
 * `~/.codex/sessions` resolves to the claude session. The two are unrelated
 * sessions that happen to share an id; claude wins because that is the
 * behaviour every id resolved to before codex existed.
 */
export function createSessionSources(maxBytes = DEFAULT_MAX_ROLLOUT_BYTES): readonly SessionSource[] {
  return [claudeSessionSource, createCodexSessionSource(maxBytes)]
}

/**
 * Every importable session under `homeDir`, PLUS the files that were refused.
 *
 * This is what "import all" scans with. Claude contributes no refusals: its
 * parser answers `null` for every failure and its scanner drops those before
 * anything here can see a path, so a claude file that will not parse is still
 * invisible to the tally. Codex — where the measured blind spot is, 99 subagent
 * rollouts and 4 over-cap files — reports every one.
 */
export function scanAllSessions(
  homeDir: string,
  maxBytes = DEFAULT_MAX_ROLLOUT_BYTES,
): SessionScanResult {
  const sessions: ImportableSession[] = []
  const refusals: SessionScanRefusal[] = []
  // Iterating `createSessionSources` rather than naming the two sources keeps
  // that function the single ordering authority.
  for (const source of createSessionSources(maxBytes)) {
    if (source.provider === "codex") {
      scanCodexInto(homeDir, source.parse, sessions, refusals)
      continue
    }
    for (const session of source.scan(homeDir)) sessions.push(session)
  }
  return { sessions, refusals }
}

export function sourceForProvider(
  provider: AgentProvider,
  maxBytes = DEFAULT_MAX_ROLLOUT_BYTES,
): SessionSource | null {
  return createSessionSources(maxBytes).find((source) => source.provider === provider) ?? null
}
