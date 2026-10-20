import { McpServer, type AuthInfo } from "@modelcontextprotocol/server"
import { APP_VERSION } from "../../shared/branding"
import type { ClientCommand, ServerEnvelope, SubscriptionTopic } from "../../shared/protocol"
import type { AppSettingsManager } from "../app-settings"
import type { EventStore } from "../event-store"
import type { RemoteMcpAuditSink } from "./remote-mcp-audit"
import type { DedupeStore } from "./remote-mcp-dedupe"
import { withEgressRedaction } from "./remote-mcp-egress-redaction"
import { REMOTE_MCP_INSTRUCTIONS } from "./remote-mcp-instructions"
import { registerKannaResources } from "./remote-mcp-resources"
import { createToolRegistrar } from "./remote-mcp-tool-registrar"
import { REMOTE_TOOLS } from "./remote-mcp-tool-table"

export interface RemoteMcpHost {
  dispatchCommand: (command: ClientCommand) => Promise<ServerEnvelope>
  readSnapshot: (topic: SubscriptionTopic) => ServerEnvelope
  refreshLocalProjects: () => Promise<void>
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

export function buildRemoteMcpServer(rawHost: RemoteMcpHost): McpServer {
  const host = withEgressRedaction(rawHost)
  const server = new McpServer({ name: "kanna", version: APP_VERSION }, { instructions: REMOTE_MCP_INSTRUCTIONS })
  const tools = createToolRegistrar(server, { era: host.era, authInfo: host.authInfo, audit: host.audit })
  for (const tool of REMOTE_TOOLS) tool.register(tools, host)
  registerKannaResources(server, host)
  return server
}
