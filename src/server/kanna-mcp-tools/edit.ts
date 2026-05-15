import { z } from "zod"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { homedir } from "node:os"
import type { ToolCallbackService } from "../tool-callback"
import type { ToolHandlerContext, ToolHandlerResult } from "./tool-callback-shim"
import { gatedToolCall } from "./tool-callback-shim"

const InputSchema = z.object({
  path: z.string(),
  oldString: z.string(),
  newString: z.string(),
})

export type EditInput = z.infer<typeof InputSchema>

export interface EditTool {
  name: "edit"
  schema: typeof InputSchema
  handler: (input: EditInput, ctx: ToolHandlerContext) => Promise<ToolHandlerResult>
}

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith("~")) return path.join(homedir(), p.slice(1).replace(/^\//, ""))
  return path.resolve(cwd, p)
}

export function createEditTool(deps: { toolCallback: ToolCallbackService }): EditTool {
  return {
    name: "edit",
    schema: InputSchema,
    async handler(input, ctx) {
      return gatedToolCall({
        toolCallback: deps.toolCallback,
        toolName: "mcp__kanna__edit",
        ctx,
        args: input as unknown as Record<string, unknown>,
        formatAnswer: async () => {
          const resolved = resolvePath(input.path, ctx.cwd)
          let content: string
          try {
            content = await readFile(resolved, "utf8")
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return {
              content: [{ type: "text" as const, text: `Error reading file: ${msg}` }],
              isError: true,
            }
          }

          // Count occurrences
          let count = 0
          let idx = 0
          while ((idx = content.indexOf(input.oldString, idx)) !== -1) {
            count++
            idx += input.oldString.length
          }

          if (count === 0) {
            return {
              content: [{ type: "text" as const, text: "Error: oldString not found in file" }],
              isError: true,
            }
          }
          if (count > 1) {
            return {
              content: [{ type: "text" as const, text: `Error: oldString is ambiguous — found ${count} occurrences` }],
              isError: true,
            }
          }

          // Use split/join instead of replace to avoid special replacement patterns
          // ($&, $1, $$, $', $`) being interpreted in newString.
          const updated = content.split(input.oldString).join(input.newString)
          try {
            await writeFile(resolved, updated, "utf8")
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return {
              content: [{ type: "text" as const, text: `Error writing file: ${msg}` }],
              isError: true,
            }
          }
          return {
            content: [{ type: "text" as const, text: "Edit applied successfully" }],
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
