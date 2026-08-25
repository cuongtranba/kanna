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
import { createImportableSession, type ImportableSession, type SessionSource } from "./session-source"

export const claudeSessionSource: SessionSource = {
  provider: "claude",
  scan: (homeDir) =>
    scanClaudeSessions(homeDir).map((session) => createImportableSession(session, claudeSessionCodec)),
  locate: (homeDir, sessionId) => locateClaudeSessionFile(homeDir, sessionId),
  parse: (filePath): ImportableSession | null => {
    const session = parseClaudeSessionFile(filePath)
    return session ? createImportableSession(session, claudeSessionCodec) : null
  },
}

/** Ordered — `importSessionsByIds` probes sources in this order, first hit wins. */
export const SESSION_SOURCES: readonly SessionSource[] = [claudeSessionSource]

export function sourceForProvider(provider: AgentProvider): SessionSource | null {
  return SESSION_SOURCES.find((source) => source.provider === provider) ?? null
}
