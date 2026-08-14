import type { TranscriptEntry } from "../shared/types"
import { normalizeClaudeStreamMessage } from "./agent"

/**
 * Parse raw `agent-<id>.jsonl` transcript lines into transcript entries.
 * Parses each line with `normalizeClaudeStreamMessage` directly — NOT
 * `createJsonlEventParser`, which drops `isSidechain:true` lines (the agent
 * files are entirely sidechain), and never feeds the turn/event pipeline
 * (c3-225). Shared by the native-subagent and workflow transcript registries.
 */
export function parseAgentTranscriptLines(lines: string[]): TranscriptEntry[] {
  const out: TranscriptEntry[] = []
  for (const line of lines) {
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      continue // partial / corrupt line — skip
    }
    if (!parsed || typeof parsed !== "object") continue
    try {
      out.push(...normalizeClaudeStreamMessage(parsed))
    } catch {
      continue // defensive: never let one bad line abort the read
    }
  }
  return out
}
