import { z } from "zod"
import type { ToolCallbackService } from "../tool-callback"
import type { ToolHandlerContext, ToolHandlerResult } from "./tool-callback-shim"
import { gatedToolCall } from "./tool-callback-shim"

const InputSchema = z.object({
  plan: z.string(),
})

export type ExitPlanModeInput = z.infer<typeof InputSchema>

export interface ExitPlanModeTool {
  name: "exit_plan_mode"
  schema: typeof InputSchema
  handler: (input: ExitPlanModeInput, ctx: ToolHandlerContext) => Promise<ToolHandlerResult>
}

export function createExitPlanModeTool(deps: { toolCallback: ToolCallbackService }): ExitPlanModeTool {
  return {
    name: "exit_plan_mode",
    schema: InputSchema,
    async handler(input, ctx) {
      return gatedToolCall({
        toolCallback: deps.toolCallback,
        toolName: "mcp__kanna__exit_plan_mode",
        ctx,
        args: input as unknown as Record<string, unknown>,
        formatAnswer: (payload) => {
          const record = (payload && typeof payload === "object")
            ? payload as Record<string, unknown>
            : {}
          if (record.confirmed) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ confirmed: true }) }],
            }
          }
          const msg = typeof record.message === "string" ? record.message : "User wants to suggest edits."
          return {
            content: [{ type: "text" as const, text: msg }],
            isError: true,
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
