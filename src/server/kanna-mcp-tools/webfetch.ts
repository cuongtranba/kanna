import { z } from "zod"
import type { ToolCallbackService } from "../tool-callback"
import type { ToolHandlerContext, ToolHandlerResult } from "./tool-callback-shim"
import { gatedToolCall } from "./tool-callback-shim"

// Note: no .url() validation — handler lets fetch throw on bad URL
const InputSchema = z.object({
  url: z.string(),
})

export type WebFetchInput = z.infer<typeof InputSchema>

export interface WebFetchTool {
  name: "webfetch"
  schema: typeof InputSchema
  handler: (input: WebFetchInput, ctx: ToolHandlerContext) => Promise<ToolHandlerResult>
}

export function createWebFetchTool(deps: { toolCallback: ToolCallbackService }): WebFetchTool {
  return {
    name: "webfetch",
    schema: InputSchema,
    async handler(input, ctx) {
      return gatedToolCall({
        toolCallback: deps.toolCallback,
        toolName: "mcp__kanna__webfetch",
        ctx,
        args: input as unknown as Record<string, unknown>,
        formatAnswer: async () => {
          try {
            const res = await fetch(input.url)
            const text = await res.text()
            return {
              content: [{ type: "text" as const, text: `Status: ${res.status}\n\n${text}` }],
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return {
              content: [{ type: "text" as const, text: `Error fetching URL: ${msg}` }],
              isError: true,
            }
          }
        },
        formatDeny: (reason) => ({
          content: [{ type: "text" as const, text: `Denied: ${reason}` }],
          isError: true,
        }),
      })
    },
  }
}
