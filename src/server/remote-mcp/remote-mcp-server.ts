import { McpServer } from "@modelcontextprotocol/server"
import { APP_VERSION } from "../../shared/branding"
import type { ClientCommand, ServerEnvelope, SubscriptionTopic } from "../../shared/protocol"
import type { AppSettingsManager } from "../app-settings"
import type { EventStore } from "../event-store"
import { registerGenericTools } from "./remote-mcp-tools-generic"
import { registerKannaResources } from "./remote-mcp-resources"
import { registerBoardTools } from "./remote-mcp-tools-boards"
import { registerChatTools } from "./remote-mcp-tools-chat"
import { registerCronTools } from "./remote-mcp-tools-cron"
import { registerFileTools } from "./remote-mcp-tools-files"
import { registerGitTools } from "./remote-mcp-tools-git"
import { registerObservabilityTools } from "./remote-mcp-tools-observability"
import { registerProjectTools } from "./remote-mcp-tools-projects"
import { registerSettingsTools } from "./remote-mcp-tools-settings"
import { registerSystemTools } from "./remote-mcp-tools-system"

export interface RemoteMcpHost {
  dispatchCommand: (command: ClientCommand) => Promise<ServerEnvelope>
  readSnapshot: (topic: SubscriptionTopic) => ServerEnvelope
  store: EventStore
  appSettings: AppSettingsManager
  machineName: string
  publicOrigin: () => string | null
  pollIntervalMs?: number
}

export function buildRemoteMcpServer(host: RemoteMcpHost): McpServer {
  const server = new McpServer({ name: "kanna", version: APP_VERSION })
  registerGenericTools(server, host)
  registerProjectTools(server, host)
  registerChatTools(server, host)
  registerGitTools(server, host)
  registerBoardTools(server, host)
  registerCronTools(server, host)
  registerSettingsTools(server, host)
  registerObservabilityTools(server, host)
  registerFileTools(server, host)
  registerSystemTools(server, host)
  registerKannaResources(server, host)
  return server
}
