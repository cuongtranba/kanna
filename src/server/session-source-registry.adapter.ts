// src/server/session-source-registry.adapter.ts
//
// The list of providers the session importer knows how to read. Adding a
// provider is one entry here plus its own scanner/parser/codec — the importer
// itself never names a provider.
//
// `.adapter.ts` because it wires the scanner + parser adapters (which do the
// file IO) onto their pure codec.

import type { AgentProvider } from "../shared/types"
import { claudeSessionCodec } from "./claude-session-mapper"
import { parseClaudeSessionFile } from "./claude-session-parser.adapter"
import { locateClaudeSessionFile, scanClaudeSessions } from "./claude-session-scanner.adapter"
import { classifyRolloutLine, isSubagentSessionMeta } from "./codex-rollout-line"
import { codexSessionCodec } from "./codex-session-mapper"
import { parseCodexRolloutFile, type CodexParserDeps } from "./codex-session-parser.adapter"
import { locateCodexRolloutFile, scanCodexRollouts } from "./codex-session-scanner.adapter"
import {
  createImportableSession,
  type ImportableSession,
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
function codexParserDeps(maxBytes: number): CodexParserDeps {
  return { classifyLine: classifyRolloutLine, isSubagentMeta: isSubagentSessionMeta, maxBytes }
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
    // both apply here — a `tooLarge` or `rejected` file is simply not offered.
    scan: (homeDir) => {
      const sessions: ImportableSession[] = []
      for (const filePath of scanCodexRollouts(homeDir)) {
        const result = parse(filePath)
        if (result.kind === "parsed") sessions.push(result.session)
      }
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

export const SESSION_SOURCES: readonly SessionSource[] = createSessionSources()

export function sourceForProvider(
  provider: AgentProvider,
  maxBytes = DEFAULT_MAX_ROLLOUT_BYTES,
): SessionSource | null {
  return createSessionSources(maxBytes).find((source) => source.provider === provider) ?? null
}
