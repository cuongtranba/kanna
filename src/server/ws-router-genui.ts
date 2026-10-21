import { datasetDeclSchema, datasetQuerySchema } from "../shared/genui"
import type { DatasetQueryOutcome } from "../shared/genui/protocol"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import type { GenUIDatasetService } from "./genui/dataset-service"
import { ackResult } from "./ws-router-ack"

function invalid(code: "invalid_dataset" | "invalid_query", message: string): DatasetQueryOutcome {
  return { status: "error", code, message }
}

async function runQuery(
  service: GenUIDatasetService,
  command: Extract<ClientCommand, { type: "genui.dataset.query" }>,
): Promise<DatasetQueryOutcome> {
  const decl = datasetDeclSchema.safeParse(command.dataset)
  if (!decl.success) return invalid("invalid_dataset", decl.error.issues[0]?.message ?? "invalid dataset")
  const query = datasetQuerySchema.safeParse(command.query)
  if (!query.success) return invalid("invalid_query", query.error.issues[0]?.message ?? "invalid query")
  return await service.query(command.chatId, decl.data, query.data, command.refresh === true)
}

export async function handleGenUICommand(
  service: GenUIDatasetService | undefined,
  send: (envelope: ServerEnvelope) => void,
  command: ClientCommand,
  id: string,
): Promise<boolean> {
  switch (command.type) {
    case "genui.dataset.query": {
      if (!service) throw new Error("Generative UI datasets are not available on this server")
      send(ackResult(id, command, await runQuery(service, command)))
      return true
    }
    case "genui.dataset.approve": {
      if (!service) throw new Error("Generative UI datasets are not available on this server")
      service.approveTool(command.chatId, command.server, command.tool)
      send(ackResult(id, command, { ok: true }))
      return true
    }
    default:
      return false
  }
}
