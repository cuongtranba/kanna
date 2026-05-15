import { z } from "zod"
import type { ToolCallbackService } from "../tool-callback"
import type { ToolHandlerContext, ToolHandlerResult } from "./tool-callback-shim"
import { gatedToolCall } from "./tool-callback-shim"

const InputSchema = z.object({
  command: z.string(),
})

export type BashInput = z.infer<typeof InputSchema>

export interface BashTool {
  name: "bash"
  schema: typeof InputSchema
  handler: (input: BashInput, ctx: ToolHandlerContext) => Promise<ToolHandlerResult>
}

export function createBashTool(deps: { toolCallback: ToolCallbackService }): BashTool {
  return {
    name: "bash",
    schema: InputSchema,
    async handler(input, ctx) {
      return gatedToolCall({
        toolCallback: deps.toolCallback,
        toolName: "mcp__kanna__bash",
        ctx,
        args: input as unknown as Record<string, unknown>,
        formatAnswer: async () => {
          const proc = Bun.spawn(["/bin/sh", "-c", input.command], {
            cwd: ctx.cwd,
            stdout: "pipe",
            stderr: "pipe",
          })
          const [stdoutBuf, stderrBuf, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
          ])
          const text = [
            stdoutBuf,
            stderrBuf ? `STDERR:\n${stderrBuf}` : "",
            `Exit code: ${exitCode}`,
          ].filter(Boolean).join("\n")
          return {
            content: [{ type: "text" as const, text }],
            isError: exitCode !== 0,
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
