import { join } from "node:path"
import { liveRunRoot } from "./workflow-watch-io.adapter"
import { agentTranscriptFileName, readJsonlLinesAt } from "./subagent-transcript-io.adapter"

export function readWorkflowAgentTranscriptLines(
  workflowsDir: string,
  runId: string,
  agentId: string,
): string[] {
  return readJsonlLinesAt(join(liveRunRoot(workflowsDir), runId, agentTranscriptFileName(agentId)))
}
