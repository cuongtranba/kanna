import { join } from "node:path"
import { liveRunRoot } from "./workflow-watch-io.adapter"
import { agentTranscriptFileName, readJsonlLinesAt } from "./subagent-transcript-io.adapter"

// Leaf IO adapter for a workflow subagent's full transcript. Claude writes each
// workflow agent's transcript to the live run dir
// `<session>/subagents/workflows/<runId>/agent-<agentId>.jsonl` — the same
// `agent-<id>.jsonl` shape the native-subagent viewer reads, just nested under
// the run dir. This adapter only reads raw lines; parsing
// (parseAgentTranscriptLines) lives in the workflow registry (side-effect
// seal: the registry takes this injected).
export function readWorkflowAgentTranscriptLines(
  workflowsDir: string,
  runId: string,
  agentId: string,
): string[] {
  return readJsonlLinesAt(join(liveRunRoot(workflowsDir), runId, agentTranscriptFileName(agentId)))
}
