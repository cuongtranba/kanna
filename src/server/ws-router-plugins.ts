import { isValidPluginId } from "../shared/plugins/manifest"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import type { PluginService } from "./plugins/plugin-service"
import { ackResult } from "./ws-router-ack"

export interface PluginsHostDep {
  enabled: () => boolean
  service: () => PluginService
}

export async function handlePluginsCommand(
  plugins: PluginsHostDep | undefined,
  send: (envelope: ServerEnvelope) => void,
  command: ClientCommand,
  id: string,
): Promise<boolean> {
  switch (command.type) {
    case "plugins.list": {
      const summaries = plugins?.enabled() ? [...plugins.service().list()] : []
      send(ackResult(id, command, { plugins: summaries }))
      return true
    }
    case "plugins.reload": {
      if (!plugins?.enabled()) throw new Error("Plugins are switched off")
      if (!isValidPluginId(command.pluginId)) throw new Error("Invalid plugin id")
      const service = plugins.service()
      if (!service.status(command.pluginId)) throw new Error(`Plugin "${command.pluginId}" is not installed`)
      await service.reload(command.pluginId)
      send(ackResult(id, command))
      return true
    }
    default:
      return false
  }
}
