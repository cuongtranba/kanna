import type { McpServer } from "@modelcontextprotocol/server"
import { APP_VERSION } from "../../shared/branding"
import type { RemoteMcpHost } from "./remote-mcp-server"
import { envelopeToToolResult } from "./remote-mcp-envelope"
import { jsonResult } from "./remote-mcp-views"

export function registerSystemTools(server: McpServer, host: RemoteMcpHost): void {
  server.registerTool(
    "get_update_status",
    {
      title: "Update status",
      description: "Read whether a newer Kanna version is available and the state of any update in progress.",
      annotations: { readOnlyHint: true },
    },
    () => envelopeToToolResult(host.readSnapshot({ type: "update" })),
  )

  server.registerTool(
    "server_info",
    {
      title: "Server info",
      description: "Report the Kanna version, the machine name and the public origin this MCP server is reached at.",
      annotations: { readOnlyHint: true },
    },
    () => jsonResult({ version: APP_VERSION, machineName: host.machineName, publicOrigin: host.publicOrigin() }),
  )
}
