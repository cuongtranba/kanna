import { z } from "zod"
import type { ToolCallbackService } from "../tool-callback"
import type { ToolHandlerContext, ToolHandlerResult } from "./tool-callback-shim"
import { gatedToolCall } from "./tool-callback-shim"

const QuestionSchema = z.object({
  text: z.string(),
  header: z.string(),
  options: z.array(z.object({ label: z.string(), description: z.string() })).min(2).max(4),
  multiSelect: z.boolean(),
})

const InputSchema = z.object({
  questions: z.array(QuestionSchema).min(1).max(4),
})

export type AskUserQuestionInput = z.infer<typeof InputSchema>

export interface AskUserQuestionTool {
  name: "ask_user_question"
  schema: typeof InputSchema
  handler: (input: AskUserQuestionInput, ctx: ToolHandlerContext) => Promise<ToolHandlerResult>
}

export function createAskUserQuestionTool(deps: { toolCallback: ToolCallbackService }): AskUserQuestionTool {
  return {
    name: "ask_user_question",
    schema: InputSchema,
    async handler(input, ctx) {
      return gatedToolCall({
        toolCallback: deps.toolCallback,
        toolName: "mcp__kanna__ask_user_question",
        ctx,
        args: input as unknown as Record<string, unknown>,
        formatAnswer: (payload) => {
          // JSON.stringify(undefined) returns undefined, which yields an
          // invalid MCP CallToolResult. The policy gate forces "ask" for
          // interactive tools, but guard the boundary anyway.
          const text = payload === undefined ? "{}" : JSON.stringify(payload)
          return {
            content: [{ type: "text" as const, text }],
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
