import type { TranscriptEntry } from "../shared/types"
import { normalizeClaudeStreamMessage } from "./agent"

export function parseAgentTranscriptLines(lines: string[]): TranscriptEntry[] {
  const out: TranscriptEntry[] = []
  for (const line of lines) {
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== "object") continue
    try {
      out.push(...normalizeClaudeStreamMessage(parsed))
    } catch {
      continue
    }
  }
  return out
}
