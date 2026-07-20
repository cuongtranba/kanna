/**
 * ws-router-orch.ts
 *
 * WS command handlers for orchestration, workflow observability, and
 * subagent-transcript queries:
 *   orch.run, orch.cancelRun, orch.getRun,
 *   workflows.getRun, workflows.getAgentTranscript,
 *   subagents.getRun
 *
 * Extracted from ws-router.ts.
 */
import { PROTOCOL_VERSION } from "../shared/types"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import type { OrchRunInput, OrchRunDetail } from "../shared/orchestration-types"
import type { WorkflowRegistry } from "./workflow-registry"
import type { SubagentTranscriptRegistry } from "./subagent-transcript-registry"

// ---------------------------------------------------------------------------
// Dep interface (duck-typed; avoids circular imports with ws-router.ts)
// ---------------------------------------------------------------------------

/** The subset of AgentCoordinator methods consumed by orch/workflow WS commands. */
export interface OrchAgentDep {
  runOrchestration(
    chatId: string,
    input: OrchRunInput,
  ): Promise<{ ok: true; runId: string } | { ok: false; errors: string[] }>
  cancelOrchRun(runId: string): Promise<void>
  getOrchRunDetail(runId: string): OrchRunDetail | null
}

export interface OrchCommandDeps {
  /** Orchestration methods from AgentCoordinator. */
  agent: OrchAgentDep
  /** Optional workflow registry (may be absent if not configured). */
  workflowRegistry: Pick<WorkflowRegistry, "getRun" | "getAgentTranscript"> | undefined
  /** Optional subagent transcript registry. */
  subagentTranscriptRegistry: Pick<SubagentTranscriptRegistry, "getAgentTranscript"> | undefined
  /** Pre-bound to the current WebSocket; called to send an ack envelope. */
  send: (envelope: ServerEnvelope) => void
}

// ---------------------------------------------------------------------------
// Command dispatcher
// ---------------------------------------------------------------------------

/**
 * Handle one orchestration/workflow/subagent-transcript WS command.
 *
 * Returns `true` when the command was handled (caller should `return`).
 * Returns `false` when the command type is outside this module's scope.
 */
export async function handleOrchCommand(
  deps: OrchCommandDeps,
  command: ClientCommand,
  id: string,
): Promise<boolean> {
  const { agent, workflowRegistry, subagentTranscriptRegistry, send } = deps

  switch (command.type) {
    case "workflows.getRun": {
      const run = workflowRegistry?.getRun(command.chatId, command.runId) ?? null
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: run })
      return true
    }
    case "workflows.getAgentTranscript": {
      const entries = workflowRegistry?.getAgentTranscript(command.chatId, command.runId, command.agentId) ?? []
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: entries })
      return true
    }
    case "subagents.getRun": {
      const entries = subagentTranscriptRegistry?.getAgentTranscript(command.chatId, command.agentId) ?? []
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: entries })
      return true
    }
    case "orch.run": {
      const result = await agent.runOrchestration(command.chatId, command.input)
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      return true
    }
    case "orch.cancelRun": {
      await agent.cancelOrchRun(command.runId)
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: { ok: true } })
      return true
    }
    case "orch.getRun": {
      send({ v: PROTOCOL_VERSION, type: "ack", id, result: agent.getOrchRunDetail(command.runId) })
      return true
    }
    default:
      return false
  }
}
