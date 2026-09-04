/**
 * The one bridge between the Agent SDK's tool definitions and the MCP SDK's
 * server.
 *
 * `SdkMcpToolDefinition` is typed against the Agent SDK's `AnyZodRawShape`,
 * while `McpServer.registerTool` wants the MCP SDK's `ZodRawShapeCompat`
 * (`Record<string, z3.ZodTypeAny | z4.$ZodType>`) and hands the handler a
 * `ShapeOutput<...>`. The two describe the same runtime objects — a single zod
 * 4.5.4 is installed, so this is not a duplicate-copy problem — but neither
 * package's type is assignable to the other's, and no type guard can prove a
 * structural claim about a third party's branded types.
 *
 * So registration is an assertion, and it is confined to this module on
 * purpose. This is the ONLY file exempt from the cast and unknown bans for
 * library interop — the same containment `dynamic-module.ts` uses — which is
 * why the whole `registerTool` call lives here rather than at the call site,
 * where it previously sat inline in `kanna-mcp-http.ts` and put an unguarded
 * `<Record<string, never>><unknown>` cast in ordinary application code.
 *
 * If the two packages ever agree on a zod major, delete the assertions and pass
 * the values straight through; the compiler will flag them as needless.
 */
import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ShapeOutput, ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js"
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js"
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js"

/** Register one Agent-SDK tool definition on an MCP server. */
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
