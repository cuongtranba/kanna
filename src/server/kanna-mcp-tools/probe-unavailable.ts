import { z } from "zod"
import type { ToolCallbackService } from "../tool-callback"
import type { ToolHandlerContext, ToolHandlerResult } from "./tool-callback-shim"
import { gatedToolCall } from "./tool-callback-shim"

const InputSchema = z.object({
  tool: z.string().describe("Name of the disallowed built-in confirmed as unavailable."),
})

export type ProbeUnavailableInput = z.infer<typeof InputSchema>

export interface ProbeUnavailableTool {
  name: "probe_unavailable"
  schema: typeof InputSchema
  handler: (input: ProbeUnavailableInput, ctx: ToolHandlerContext) => Promise<ToolHandlerResult>
}

export function createProbeUnavailableTool(deps: { toolCallback: ToolCallbackService }): ProbeUnavailableTool {
  return {
    name: "probe_unavailable",
    schema: InputSchema,
    async handler(input, ctx) {
      return gatedToolCall({
        toolCallback: deps.toolCallback,
        toolName: "mcp__kanna__probe_unavailable",
        ctx,
        args: input as unknown as Record<string, unknown>,
        formatAnswer: () => ({
          content: [{ type: "text" as const, text: `Acknowledged: ${input.tool} is unavailable.` }],
        }),
        formatDeny: (reason) => ({
          content: [{ type: "text" as const, text: `Denied: ${reason}` }],
          isError: true,
        }),
      })
    },
  }
}
