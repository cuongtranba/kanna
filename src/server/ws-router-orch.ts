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
import type { EventStore } from "./event-store"
import { deriveImportedSubagentsDir } from "./imported-subagents-dir"

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
  subagentTranscriptRegistry: Pick<SubagentTranscriptRegistry, "has" | "register" | "getAgentTranscript"> | undefined
  /** Chat/project lookup, used to lazily derive the subagents dir for imported chats. */
  store: Pick<EventStore, "getChat" | "getProject">
  /** Pre-bound to the current WebSocket; called to send an ack envelope. */
  send: (envelope: ServerEnvelope) => void
}

/**
 * For an imported chat with no live-driver registration yet, lazily derive
 * and register its `subagents/` dir so `subagents.getRun` can serve
 * drill-in reads. A no-op when already registered (live registrations,
 * driver-owned, always win) or when the chat/project/session-token lookup
 * comes up short.
 */
function ensureSubagentDirRegistered(
  registry: Pick<SubagentTranscriptRegistry, "has" | "register">,
  store: Pick<EventStore, "getChat" | "getProject">,
  chatId: string,
): void {
  if (registry.has(chatId)) return
  const chat = store.getChat(chatId)
  const token = chat?.sessionTokensByProvider.claude
  if (!chat || !token) return
  const project = store.getProject(chat.projectId)
  if (!project) return
  registry.register(chatId, deriveImportedSubagentsDir({ cwd: project.localPath, claudeSessionToken: token }))
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
  const { agent, workflowRegistry, subagentTranscriptRegistry, store, send } = deps

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
      if (subagentTranscriptRegistry) ensureSubagentDirRegistered(subagentTranscriptRegistry, store, command.chatId)
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
