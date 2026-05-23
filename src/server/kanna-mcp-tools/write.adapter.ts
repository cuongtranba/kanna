import { z } from "zod"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { homedir } from "node:os"
import type { ToolCallbackService } from "../tool-callback"
import type { ToolHandlerContext, ToolHandlerResult } from "./tool-callback-shim"
import { gatedToolCall } from "./tool-callback-shim"

const InputSchema = z.object({
  path: z.string(),
  content: z.string(),
})

export type WriteInput = z.infer<typeof InputSchema>

export interface WriteTool {
  name: "write"
  schema: typeof InputSchema
  handler: (input: WriteInput, ctx: ToolHandlerContext) => Promise<ToolHandlerResult>
}

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith("~")) return path.join(homedir(), p.slice(1).replace(/^\//, ""))
  return path.resolve(cwd, p)
}

export function createWriteTool(deps: { toolCallback: ToolCallbackService }): WriteTool {
  return {
    name: "write",
    schema: InputSchema,
    async handler(input, ctx) {
      return gatedToolCall({
        toolCallback: deps.toolCallback,
        toolName: "mcp__kanna__write",
        ctx,
        args: input as unknown as Record<string, unknown>,
        formatAnswer: async () => {
          const resolved = resolvePath(input.path, ctx.cwd)
          try {
            await mkdir(path.dirname(resolved), { recursive: true })
            await writeFile(resolved, input.content, "utf8")
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return {
              content: [{ type: "text" as const, text: `Error writing file: ${msg}` }],
              isError: true,
            }
          }
          return {
            content: [{ type: "text" as const, text: `File written: ${resolved}` }],
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
