import { McpServer, type AuthInfo } from "@modelcontextprotocol/server"
import { APP_VERSION } from "../../shared/branding"
import type { ClientCommand, ServerEnvelope, SubscriptionTopic } from "../../shared/protocol"
import type { AppSettingsManager } from "../app-settings"
import type { EventStore } from "../event-store"
import type { RemoteMcpAuditSink } from "./remote-mcp-audit"
import type { DedupeStore } from "./remote-mcp-dedupe"
import { REMOTE_MCP_INSTRUCTIONS } from "./remote-mcp-instructions"
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
import { createToolRegistrar } from "./remote-mcp-tool-registrar"

export interface RemoteMcpHost {
  dispatchCommand: (command: ClientCommand) => Promise<ServerEnvelope>
  readSnapshot: (topic: SubscriptionTopic) => ServerEnvelope
  store: EventStore
  appSettings: AppSettingsManager
  machineName: string
  publicOrigin: () => string | null
  era: "legacy" | "modern"
  authInfo?: AuthInfo
  audit: RemoteMcpAuditSink
  dedupe: DedupeStore
  pollIntervalMs?: number
}

export function buildRemoteMcpServer(host: RemoteMcpHost): McpServer {
  const server = new McpServer({ name: "kanna", version: APP_VERSION }, { instructions: REMOTE_MCP_INSTRUCTIONS })
  const tools = createToolRegistrar(server, { era: host.era, authInfo: host.authInfo, audit: host.audit })
  registerGenericTools(tools, host)
  registerProjectTools(tools, host)
  registerChatTools(tools, host)
  registerGitTools(tools, host)
  registerBoardTools(tools, host)
  registerCronTools(tools, host)
  registerSettingsTools(tools, host)
  registerObservabilityTools(tools, host)
  registerFileTools(tools, host)
  registerSystemTools(tools, host)
  registerKannaResources(server, host)
  return server
}
