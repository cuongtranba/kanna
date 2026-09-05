import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export interface SubagentTranscriptIo {
  readAgentTranscriptLines(subagentsDir: string, agentId: string): string[]
}

export function agentTranscriptFileName(agentId: string): string {
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
