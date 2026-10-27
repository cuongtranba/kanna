import { z } from "zod"
import { APP_VERSION } from "../../shared/branding"
import { envelopeToToolResult } from "./remote-mcp-views"
import { mcpOnlyTool, topicTool, type RemoteTool } from "./remote-mcp-tool-spec"
import { jsonResult } from "./remote-mcp-views"

export const systemTools: readonly RemoteTool[] = [
  topicTool({
    name: "get_update_status",
    title: "Update status",
    description: "Read whether a newer Kanna version is available and the state of any update in progress.",
    annotations: { readOnlyHint: true },
    topic: "update",
    input: z.object({}),
    handle: (_args, { host }) => envelopeToToolResult(host.readSnapshot({ type: "update" })),
  }),
  mcpOnlyTool({
    name: "server_info",
    title: "Server info",
    description: "Report the Kanna version, the machine name and the public origin this MCP server is reached at.",
    annotations: { readOnlyHint: true },
    reason: "Describes this MCP endpoint (version, machine name, public origin); no command or topic carries it.",
    input: z.object({}),
    handle: (_args, { host }) => jsonResult({ version: APP_VERSION, machineName: host.machineName, publicOrigin: host.publicOrigin() }),
  }),
]
