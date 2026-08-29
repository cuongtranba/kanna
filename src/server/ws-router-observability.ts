/**
 * ws-router-observability.ts
 *
 * WS command handlers for workflow observability and subagent-transcript
 * queries:
 *   workflows.getRun, workflows.getAgentTranscript,
 *   subagents.getRun
 *
 * Extracted from ws-router.ts.
 */
import { PROTOCOL_VERSION } from "../shared/types"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import type { WorkflowRegistry } from "./workflow-registry"
import type { SubagentTranscriptRegistry } from "./subagent-transcript-registry"
import type { EventStore } from "./event-store"
import type { BackgroundTaskOutputRegistry } from "./background-task-output-registry"
import { deriveImportedSubagentsDir } from "./imported-subagents-dir"

// ---------------------------------------------------------------------------
// Dep interface (duck-typed; avoids circular imports with ws-router.ts)
// ---------------------------------------------------------------------------

export interface ObservabilityCommandDeps {
  /** Optional workflow registry (may be absent if not configured). */
  workflowRegistry: Pick<WorkflowRegistry, "getRun" | "getAgentTranscript"> | undefined
  /** Optional subagent transcript registry. */
  subagentTranscriptRegistry: Pick<SubagentTranscriptRegistry, "has" | "register" | "getAgentTranscript"> | undefined
  /** Optional background-task output registry. */
  backgroundTaskOutputRegistry: BackgroundTaskOutputRegistry | undefined
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
 * Handle one workflow/subagent-transcript WS command.
 *
 * Returns `true` when the command was handled (caller should `return`).
 * Returns `false` when the command type is outside this module's scope.
 */
export async function handleObservabilityCommand(
  deps: ObservabilityCommandDeps,
  command: ClientCommand,
  id: string,
): Promise<boolean> {
  const { workflowRegistry, subagentTranscriptRegistry, backgroundTaskOutputRegistry, store, send } = deps

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
    case "backgroundTasks.getOutput": {
      const output = backgroundTaskOutputRegistry?.getOutput(command.chatId, command.taskId)
      send({
        v: PROTOCOL_VERSION,
        type: "snapshot",
        id,
        snapshot: {
          type: "background-task-output",
          data: {
            chatId: command.chatId,
            taskId: command.taskId,
            content: output?.content ?? "",
            truncated: output?.truncated ?? false,
          },
        },
      })
      return true
    }
    default:
      return false
  }
}
