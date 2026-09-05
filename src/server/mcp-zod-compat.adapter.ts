import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ShapeOutput, ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js"
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js"
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js"

export function registerSdkToolOnMcpServer(mcp: McpServer, def: SdkMcpToolDefinition): void {
  const handler = async (
    input: ShapeOutput<ZodRawShapeCompat>,
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  ) => await def.handler(<never>input, <never>extra)
  mcp.registerTool(
    def.name,
    {
      description: def.description,
      inputSchema: <ZodRawShapeCompat><unknown>def.inputSchema,
    },
    handler,
  )
}
