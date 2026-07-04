import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { liveRunRoot } from "./workflow-watch-io.adapter"

// Leaf IO adapter for a workflow subagent's full transcript. Claude writes each
// workflow agent's transcript to the live run dir
// `<session>/subagents/workflows/<runId>/agent-<agentId>.jsonl` — the same
// `agent-<id>.jsonl` shape the native-subagent viewer reads, just nested under
// the run dir. This adapter only reads raw lines; parsing
// (normalizeClaudeStreamMessage) lives in the workflow registry (side-effect
// seal: the registry takes this injected). Mirrors
// `readAgentTranscriptLines` in subagent-transcript-io.adapter.ts.

function agentFileName(agentId: string): string {
  // Sidecar `agentId` values are plain ids (e.g. "a47b2a2f5d666f691"); guard
  // against a caller that already prefixed it so either form resolves.
  const base = agentId.startsWith("agent-") ? agentId : `agent-${agentId}`
  return `${base}.jsonl`
}

export function readWorkflowAgentTranscriptLines(
  workflowsDir: string,
  runId: string,
  agentId: string,
): string[] {
  const path = join(liveRunRoot(workflowsDir), runId, agentFileName(agentId))
  if (!existsSync(path)) return []
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    return []
  }
  return text.split("\n").filter((line) => line.trim().length > 0)
}
