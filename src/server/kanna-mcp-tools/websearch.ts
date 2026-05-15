import { z } from "zod"
import type { ToolCallbackService } from "../tool-callback"
import type { ToolHandlerContext, ToolHandlerResult } from "./tool-callback-shim"
import { gatedToolCall } from "./tool-callback-shim"

const InputSchema = z.object({
  query: z.string(),
})

export type WebSearchInput = z.infer<typeof InputSchema>

export interface WebSearchTool {
  name: "websearch"
  schema: typeof InputSchema
  handler: (input: WebSearchInput, ctx: ToolHandlerContext) => Promise<ToolHandlerResult>
}

export function createWebSearchTool(deps: { toolCallback: ToolCallbackService }): WebSearchTool {
  return {
    name: "websearch",
    schema: InputSchema,
    async handler(input, ctx) {
      return gatedToolCall({
        toolCallback: deps.toolCallback,
        toolName: "mcp__kanna__websearch",
        ctx,
        args: input as unknown as Record<string, unknown>,
        formatAnswer: async () => ({
          content: [{
            type: "text" as const,
            text: "WebSearch unavailable in this environment. Use mcp__kanna__webfetch with a specific URL if you already know the target.",
          }],
          isError: true,
        }),
        formatDeny: (reason) => ({
          content: [{ type: "text" as const, text: `Denied: ${reason}` }],
          isError: true,
        }),
      })
    },
  }
}
