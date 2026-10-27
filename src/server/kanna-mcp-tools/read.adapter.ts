import { z } from "zod"
import { readFile } from "node:fs/promises"
import { currentHomeDir } from "../home-dir.adapter"
import { resolveUserPath } from "../home-path"
import type { ToolCallbackService } from "../tool-callback"
import type { ToolHandlerContext, ToolHandlerResult } from "./tool-callback-shim"
import { gatedToolCall } from "./tool-callback-shim"

const InputSchema = z.object({
  path: z.string(),
})

export type ReadInput = z.infer<typeof InputSchema>

export interface ReadTool {
  name: "read"
  schema: typeof InputSchema
  handler: (input: ReadInput, ctx: ToolHandlerContext) => Promise<ToolHandlerResult>
}

export function createReadTool(deps: { toolCallback: ToolCallbackService }): ReadTool {
  return {
    name: "read",
    schema: InputSchema,
    async handler(input, ctx) {
      return gatedToolCall({
        toolCallback: deps.toolCallback,
        toolName: "mcp__kanna__read",
        ctx,
        args: input,
        formatAnswer: async () => {
          try {
            const resolved = resolveUserPath(input.path, ctx.cwd, currentHomeDir())
            const content = await readFile(resolved, "utf8")
            return {
              content: [{ type: "text" as const, text: content }],
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return {
              content: [{ type: "text" as const, text: `Error reading file: ${msg}` }],
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
