import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { APP_VERSION } from "../../shared/branding"
import type { ClientCommand, ServerEnvelope, SubscriptionTopic } from "../../shared/protocol"
import type { AppSettingsManager } from "../app-settings"
import type { EventStore } from "../event-store"
import { registerGenericTools } from "./remote-mcp-tools-generic"
import { registerKannaResources } from "./remote-mcp-resources"

export interface RemoteMcpHost {
  dispatchCommand: (command: ClientCommand) => Promise<ServerEnvelope>
  readSnapshot: (topic: SubscriptionTopic) => ServerEnvelope
  store: EventStore
  appSettings: AppSettingsManager
}

export function buildRemoteMcpServer(host: RemoteMcpHost): McpServer {
  const server = new McpServer({ name: "kanna", version: APP_VERSION })
  registerGenericTools(server, host)
  registerKannaResources(server, host)
  return server
}
