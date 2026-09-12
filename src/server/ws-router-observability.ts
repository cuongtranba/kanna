import { PROTOCOL_VERSION } from "../shared/types"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import type { WorkflowRegistry } from "./workflow-registry"
import type { SubagentTranscriptRegistry } from "./subagent-transcript-registry"
import type { EventStore } from "./event-store"
import { deriveImportedSubagentsDir } from "./imported-subagents-dir"


export interface ObservabilityCommandDeps {
  workflowRegistry: Pick<WorkflowRegistry, "getRun" | "getAgentTranscript"> | undefined
  subagentTranscriptRegistry: Pick<SubagentTranscriptRegistry, "has" | "register" | "getAgentTranscript"> | undefined
  store: Pick<EventStore, "getChat" | "getProject">
  send: (envelope: ServerEnvelope) => void
}

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


export async function handleObservabilityCommand(
  deps: ObservabilityCommandDeps,
  command: ClientCommand,
  id: string,
): Promise<boolean> {
  const { workflowRegistry, subagentTranscriptRegistry, store, send } = deps

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
    default:
      return false
  }
}
