import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

// Leaf IO adapter for native `Agent`/`Task` subagent transcripts. Claude writes
// each subagent's full transcript to `<projectDir>/<claude-uuid>/subagents/
// agent-<agentId>.jsonl`. This adapter only reads raw lines; parsing lives in
// the registry (side-effect seal: the registry takes this injected).
export interface SubagentTranscriptIo {
  readAgentTranscriptLines(subagentsDir: string, agentId: string): string[]
}

export function agentTranscriptFileName(agentId: string): string {
  // Claude names the file `agent-<agentId>.jsonl`. Guard against an agentId
  // that already carries the prefix so callers can pass either form.
  const base = agentId.startsWith("agent-") ? agentId : `agent-${agentId}`
  return `${base}.jsonl`
}

export function readJsonlLinesAt(path: string): string[] {
  if (!existsSync(path)) return []
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    return []
  }
  return text.split("\n").filter((line) => line.trim().length > 0)
}

export function readAgentTranscriptLines(subagentsDir: string, agentId: string): string[] {
  return readJsonlLinesAt(join(subagentsDir, agentTranscriptFileName(agentId)))
}

export const subagentTranscriptIo: SubagentTranscriptIo = { readAgentTranscriptLines }
