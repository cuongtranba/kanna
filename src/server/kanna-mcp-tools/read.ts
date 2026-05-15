import { z } from "zod"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { homedir } from "node:os"
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

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith("~")) return path.join(homedir(), p.slice(1).replace(/^\//, ""))
  return path.resolve(cwd, p)
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
        args: input as unknown as Record<string, unknown>,
        formatAnswer: async () => {
          try {
            const resolved = resolvePath(input.path, ctx.cwd)
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
